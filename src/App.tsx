import { useState, useEffect, useRef } from 'react';
import imageCompression from 'browser-image-compression';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

interface PhotoRecord {
  id: string;
  timestamp: number;
  date: string;
  author: string;
  imageUrl: string;
  isLocal?: boolean; // flag for immediate local feedback
}

type TabType = 'capture' | 'feed' | 'stats';

function App() {
  // PWA Install Prompt State
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstallable, setIsInstallable] = useState<boolean>(false);

  // Authentication & Onboarding
  const [username, setUsername] = useState<string>(() => localStorage.getItem('omc_user_name') || '');
  const [isOnboarded, setIsOnboarded] = useState<boolean>(() => !!localStorage.getItem('omc_user_name'));
  const [tempUsername, setTempUsername] = useState<string>(() => localStorage.getItem('omc_user_name') || '');

  // Tab Navigation
  const [activeTab, setActiveTab] = useState<TabType>('capture');

  // Feed Data
  const [feed, setFeed] = useState<PhotoRecord[]>([]);
  const [localUploads, setLocalUploads] = useState<PhotoRecord[]>(() => {
    const storedLocal = localStorage.getItem('omc_local_uploads');
    if (storedLocal) {
      try {
        return JSON.parse(storedLocal) as PhotoRecord[];
      } catch (e) {
        console.error('Error parsing local uploads:', e);
      }
    }
    return [];
  });
  const [isLoadingFeed, setIsLoadingFeed] = useState<boolean>(false);

  // Capture State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadStatus, setUploadStatus] = useState<string>('');
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch global feed asynchronously to avoid synchronous setState inside render/effect body
  const fetchFeed = async (active = true) => {
    setIsLoadingFeed(true);
    try {
      const res = await fetch(`/data.json?cb=${Date.now()}`);
      if (res.ok && active) {
        const data: PhotoRecord[] = await res.json();
        setFeed(data);
      }
    } catch (err) {
      console.error('Failed to fetch feed metadata:', err);
    } finally {
      if (active) {
        setIsLoadingFeed(false);
      }
    }
  };

  useEffect(() => {
    let active = true;

    // Run asynchronously outside the direct effect execution flow to prevent react-hooks/set-state-in-effect warnings
    setTimeout(() => {
      if (active) {
        fetchFeed(active);
      }
    }, 0);

    const interval = setInterval(() => {
      if (active) {
        fetchFeed(active);
      }
    }, 30000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  // PWA Installation Prompts
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setIsInstallable(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`User installation choice: ${outcome}`);
    setDeferredPrompt(null);
    setIsInstallable(false);
  };

  // Combine global feed and local uploads
  const getMergedFeed = (): PhotoRecord[] => {
    // Filter local uploads that have already been integrated into the global feed
    const globalIds = new Set(feed.map((item) => item.id));
    const pendingLocals = localUploads.filter((item) => !globalIds.has(item.id));
    
    // Sort combined: newest first
    return [...pendingLocals, ...feed].sort((a, b) => b.timestamp - a.timestamp);
  };

  const handleOnboardingSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = tempUsername.trim();
    if (trimmed) {
      localStorage.setItem('omc_user_name', trimmed);
      setUsername(trimmed);
      setIsOnboarded(true);
    }
  };

  const handleLogout = () => {
    if (window.confirm('Voulez-vous vraiment changer de pseudonyme ?')) {
      localStorage.removeItem('omc_user_name');
      setUsername('');
      setIsOnboarded(false);
      setTempUsername('');
    }
  };

  // Viewfinder click triggers file input
  const triggerCamera = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  // File change handler
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      setSelectedFile(file);
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    }
  };

  const handleCancelPreview = () => {
    setSelectedFile(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // File reader helper for Base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
    });
  };

  // Upload action
  const handleUpload = async () => {
    if (!selectedFile || !username) return;

    setIsUploading(true);
    setUploadStatus('Compression de l\'image...');

    try {
      // 1. Image compression (150-200 KB target WebP)
      const options = {
        maxSizeMB: 0.2, // 200 KB
        maxWidthOrHeight: 1080,
        useWebWorker: true,
        fileType: 'image/webp' as const,
      };

      const compressedFile = await imageCompression(selectedFile, options);
      
      setUploadStatus('Conversion au format transfert...');
      const base64Image = await fileToBase64(compressedFile);

      setUploadStatus('Envoi sécurisé sur GitHub...');
      
      const response = await fetch('/api/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image: base64Image,
          author: username,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        const errorMsg = result.details
          ? `${result.error || 'Erreur lors de l\'envoi'} (Détails: ${result.details})`
          : (result.error || 'Erreur lors de l\'envoi');
        throw new Error(errorMsg);
      }

      setUploadStatus('Succès !');

      // Create a temporary local record for immediate preview
      const localRecord: PhotoRecord = {
        id: (result.photo?.id as string) || `${Date.now()}_${username}`,
        timestamp: (result.photo?.timestamp as number) || Date.now(),
        date: (result.photo?.date as string) || new Date().toISOString(),
        author: username,
        // Fallback to local preview URL for immediate display
        imageUrl: previewUrl || '', 
        isLocal: true,
      };

      // Add to local uploads list
      const updatedLocals = [localRecord, ...localUploads];
      setLocalUploads(updatedLocals);
      localStorage.setItem('omc_local_uploads', JSON.stringify(updatedLocals));

      // Reset states
      setSelectedFile(null);
      setPreviewUrl(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      // Switch to Feed to see the new photo
      setActiveTab('feed');
      // Fetch feed in background
      fetchFeed();

    } catch (err: unknown) {
      console.error(err);
      const error = err as Error;
      alert(`Erreur: ${error.message || 'Impossible de téléverser l\'image'}`);
    } finally {
      setIsUploading(false);
      setUploadStatus('');
    }
  };

  // Dashboard Stats Calculations
  const mergedFeed = getMergedFeed();
  const globalCount = mergedFeed.length;
  const personalCount = mergedFeed.filter(
    (item) => item.author.toLowerCase() === username.toLowerCase()
  ).length;

  const getPhotosTodayCount = () => {
    const today = new Date().toDateString();
    return mergedFeed.filter((item) => new Date(item.timestamp).toDateString() === today).length;
  };

  const getWeeklyAverage = () => {
    if (mergedFeed.length === 0) return 0;
    
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    const timestamps = mergedFeed.map((item) => item.timestamp);
    const minTimestamp = Math.min(...timestamps);
    const elapsedMs = now - minTimestamp;
    const elapsedWeeks = Math.max(1, Math.ceil(elapsedMs / (1000 * 60 * 60 * 24 * 7)));
    
    return (globalCount / elapsedWeeks).toFixed(1);
  };

  // Activity Chart Logic (last 7 days)
  const getLast7DaysActivity = () => {
    const days = [];
    const counts = [];
    const dayLabels = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
    
    const baseDate = new Date();
    
    for (let i = 6; i >= 0; i--) {
      const d = new Date(baseDate);
      d.setDate(d.getDate() - i);
      const dateStr = d.toDateString();
      
      const count = mergedFeed.filter(
        (item) => new Date(item.timestamp).toDateString() === dateStr
      ).length;
      
      days.push({
        label: dayLabels[d.getDay()],
        count,
      });
      counts.push(count);
    }
    
    const maxCount = Math.max(...counts, 1); // Avoid division by zero
    return days.map((day) => ({
      ...day,
      percentage: (day.count / maxCount) * 100,
    }));
  };

  const chartData = getLast7DaysActivity();

  if (!isOnboarded) {
    return (
      <div className="onboarding-screen">
        <div className="onboarding-card">
          <div className="onboarding-art">🚬</div>
          <h1 className="onboarding-title">One Million Cigarettes</h1>
          <p className="onboarding-desc">
            Rejoignez l'expérience PWA collaborative sans base de données. Prenez un cliché en un clic et partagez-le instantanément.
          </p>
          {isInstallable && (
            <button
              className="btn-secondary"
              onClick={handleInstallClick}
              style={{
                width: '100%',
                marginBottom: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
              }}
            >
              📲 Installer l'application
            </button>
          )}
          <form className="onboarding-form" onSubmit={handleOnboardingSubmit}>
            <div className="form-group">
              <label className="input-label" htmlFor="username">Pseudonyme anonyme</label>
              <input
                id="username"
                className="text-input"
                type="text"
                placeholder="Ex: SmokingJoker"
                value={tempUsername}
                onChange={(e) => setTempUsername(e.target.value)}
                maxLength={20}
                required
              />
            </div>
            <button className="btn-primary" type="submit">
              Entrer et Capturer
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* App Header */}
      <header className="app-header">
        <div className="logo-container">
          <span className="logo-emoji">🚬</span>
          <span className="logo-text">OMC</span>
        </div>
        <div className="user-badge" onClick={handleLogout} title="Cliquez pour modifier">
          👤 {username}
        </div>
      </header>

      {/* App Content */}
      <main className="app-content">
        {activeTab === 'capture' && (
          <div className="capture-screen">
            {!previewUrl ? (
              <div className="viewfinder" onClick={triggerCamera}>
                <div className="viewfinder-content">
                  <div className="camera-lens">📸</div>
                  <div className="capture-label">Prendre une photo</div>
                  <div className="capture-hint">Utilise l'appareil photo ou la galerie</div>
                </div>
                <input
                  ref={fileInputRef}
                  className="hidden-input"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleFileChange}
                />
              </div>
            ) : (
              <div className="preview-container">
                <div className="preview-wrapper">
                  <img className="preview-image" src={previewUrl} alt="Aperçu de la capture" />
                  {isUploading && (
                    <div className="loading-overlay">
                      <div className="spinner"></div>
                      <div className="loading-text">{uploadStatus}</div>
                    </div>
                  )}
                </div>
                <div className="preview-actions">
                  <button
                    className="btn-secondary"
                    onClick={handleCancelPreview}
                    disabled={isUploading}
                  >
                    Annuler
                  </button>
                  <button className="btn-primary" onClick={handleUpload} disabled={isUploading}>
                    Valider & Publier
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'feed' && (
          <div className="feed-screen">
            <div className="feed-header">
              <h2 className="feed-title">Le Flux Commun</h2>
              <p className="feed-subtitle">Dernières captures de la communauté en temps réel</p>
            </div>

            {isLoadingFeed && feed.length === 0 ? (
              <div className="empty-feed">
                <div className="spinner"></div>
                <div>Chargement du flux...</div>
              </div>
            ) : mergedFeed.length === 0 ? (
              <div className="empty-feed">
                <div className="empty-feed-icon">📸</div>
                <div>Aucun cliché pour le moment.</div>
                <button className="btn-primary" onClick={() => setActiveTab('capture')}>
                  Prendre la première photo
                </button>
              </div>
            ) : (
              <div className="feed-list">
                {mergedFeed.map((photo) => (
                  <div className="feed-card" key={photo.id}>
                    {photo.isLocal && <span className="feed-card-badge">Envoi en cours</span>}
                    <div className="feed-card-image-wrapper">
                      <img
                        className="feed-card-image"
                        src={photo.imageUrl}
                        alt={`Photo de ${photo.author}`}
                        loading="lazy"
                      />
                    </div>
                    <div className="feed-card-info">
                      <div className="feed-card-meta">
                        <span className="feed-card-author">@{photo.author}</span>
                        <span className="feed-card-date">
                          {new Date(photo.timestamp).toLocaleString('fr-FR', {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })}
                        </span>
                      </div>
                      <button className="feed-card-action" title="Signaler cette photo">
                        ⚠️
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'stats' && (
          <div className="stats-screen">
            <div className="feed-header">
              <h2 className="feed-title">Dashboard Analytique</h2>
              <p className="feed-subtitle">Statistiques basées sur l'activité du dépôt GitHub</p>
            </div>

            <div className="stats-grid">
              <div className="stats-card highlight">
                <div className="stats-header">
                  <span className="stats-title">Total Global</span>
                  <span className="stats-icon">🌍</span>
                </div>
                <span className="stats-value">{globalCount}</span>
              </div>

              <div className="stats-card accent">
                <div className="stats-header">
                  <span className="stats-title">Vos Photos</span>
                  <span className="stats-icon">👤</span>
                </div>
                <span className="stats-value">{personalCount}</span>
              </div>

              <div className="stats-card">
                <div className="stats-header">
                  <span className="stats-title">Aujourd'hui</span>
                  <span className="stats-icon">📅</span>
                </div>
                <span className="stats-value">{getPhotosTodayCount()}</span>
              </div>

              <div className="stats-card">
                <div className="stats-header">
                  <span className="stats-title">Moyenne Hebdo</span>
                  <span className="stats-icon">📈</span>
                </div>
                <span className="stats-value">{getWeeklyAverage()}</span>
              </div>
            </div>

            {/* Contribution chart */}
            <div className="chart-section">
              <h3 className="chart-title">Activité des 7 derniers jours</h3>
              <div className="activity-grid">
                {chartData.map((day, idx) => (
                  <div className="activity-bar-container" key={idx}>
                    <div className="activity-bar">
                      <div
                        className="activity-bar-fill"
                        style={{ height: `${day.percentage}%` }}
                        title={`${day.count} photos`}
                      ></div>
                    </div>
                    <span className="activity-day-label">{day.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* PWA Installation Card */}
            {isInstallable && (
              <div className="settings-section" style={{ marginBottom: '16px' }}>
                <h3 className="chart-title">Installer l'application</h3>
                <p className="onboarding-desc" style={{ fontSize: '0.85rem', marginBottom: '16px' }}>
                  Ajoutez OMC à votre écran d'accueil pour une expérience plein écran immersive et fluide.
                </p>
                <button
                  className="btn-primary"
                  onClick={handleInstallClick}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                  }}
                >
                  📲 Installer OMC sur mon mobile
                </button>
              </div>
            )}

            {/* Profile Modification */}
            <div className="settings-section">
              <h3 className="chart-title">Modifier votre profil</h3>
              <form
                className="settings-input-group"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (tempUsername.trim()) {
                    localStorage.setItem('omc_user_name', tempUsername.trim());
                    setUsername(tempUsername.trim());
                    alert('Pseudonyme enregistré !');
                  }
                }}
              >
                <input
                  className="text-input"
                  type="text"
                  value={tempUsername}
                  onChange={(e) => setTempUsername(e.target.value)}
                  maxLength={20}
                  required
                />
                <button className="btn-primary" type="submit">
                  Sauvegarder
                </button>
              </form>
            </div>
          </div>
        )}
      </main>

      {/* Navigation Footer */}
      <nav className="app-nav">
        <button
          className={`nav-item ${activeTab === 'capture' ? 'active' : ''}`}
          onClick={() => setActiveTab('capture')}
        >
          <span className="nav-icon">📸</span>
          <span>Capturer</span>
        </button>
        <button
          className={`nav-item ${activeTab === 'feed' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('feed');
            fetchFeed();
          }}
        >
          <span className="nav-icon">💬</span>
          <span>Le Feed</span>
        </button>
        <button
          className={`nav-item ${activeTab === 'stats' ? 'active' : ''}`}
          onClick={() => setActiveTab('stats')}
        >
          <span className="nav-icon">📊</span>
          <span>Stats</span>
        </button>
      </nav>
    </>
  );
}

export default App;
