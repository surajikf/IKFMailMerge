import { lazy, Suspense, useState, useEffect, useMemo } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Link } from 'react-router-dom';
import axios from 'axios';
import { 
  Box, 
  ThemeProvider, 
  createTheme, 
  CssBaseline, 
  Tooltip, 
  CircularProgress, 
  Container,
  Typography,
} from '@mui/material';
import {
  AddCircleOutline as StartIcon,
  Dashboard as DashboardIcon,
  Settings as SettingsIcon,
} from '@mui/icons-material';

import FileUpload from './pages/FileUpload';
import ConfigurationStudio from './pages/ConfigurationStudio';
import './index.css';

const Dashboard = lazy(() => import('./pages/Dashboard'));

const SystemStatusBadge = () => {
    const [status, setStatus] = useState<{ provider: string | null, smtp: string | null }>({ provider: null, smtp: null });
    
    useEffect(() => {
        const fetchStatus = () => {
            axios.get('/api/settings').then(res => {
                setStatus({ provider: res.data.active_provider, smtp: res.data.active_smtp_name });
            }).catch(() => {});
        };
        fetchStatus();
        const interval = setInterval(fetchStatus, 30000); // Refresh every 30s
        return () => clearInterval(interval);
    }, []);

    const label = status.provider === 'SMTP' || status.provider === 'GMAIL_SMTP' 
        ? (status.smtp || 'SMTP Bridge') 
        : (status.provider || 'Standby');

    const isActive = !!status.provider;

    return (
        <Tooltip title={isActive ? `Connected via ${status.provider}${status.smtp ? ` (${status.smtp})` : ''}` : 'System Standby'}>
            <Box sx={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 1.5, 
                px: 2, 
                py: 0.75,
                bgcolor: isActive ? 'var(--success-glow)' : 'var(--surface-divider)',
                borderRadius: '999px',
                border: '1px solid',
                borderColor: isActive ? 'rgba(16, 185, 129, 0.2)' : 'var(--surface-border)',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                '&:hover': { transform: 'translateY(-1px)', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }
            }}>
                <Box className={isActive ? "status-pulse" : ""} sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: isActive ? 'var(--success)' : 'var(--text-muted)' }} />
                <Typography variant="caption" sx={{ fontWeight: 700, color: isActive ? 'var(--text-main)' : 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: '0.6rem' }}>
                    {label}
                </Typography>
            </Box>
        </Tooltip>
    );
};

const AppLayout = ({ children }: { children: React.ReactNode }) => {
    const [scrolled, setScrolled] = useState(false);

    useEffect(() => {
        const handleScroll = () => setScrolled(window.scrollY > 20);
        window.addEventListener('scroll', handleScroll, { passive: true });
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    return (
        <Box className="animate-up" sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
            <header className={`studio-header ${scrolled ? 'scrolled' : ''}`}>
                <Container maxWidth={false} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: { xs: 2, md: 6 } }}>
                    {/* Logo Area */}
                    <Box component={Link} to="/" sx={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Box 
                            component="img" 
                            src="/ikf.png" 
                            alt="IKF Logo" 
                            sx={{ 
                                height: { xs: 24, md: 32 }, 
                                width: 'auto',
                                filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.05))',
                                transition: 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
                                '&:hover': { transform: 'scale(1.1) rotate(-3deg)' }
                            }} 
                        />
                        <Box sx={{ borderLeft: '1.5px solid var(--surface-divider)', pl: 2, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                           <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Typography variant="subtitle2" sx={{ fontWeight: 800, color: 'var(--text-main)', lineHeight: 1, letterSpacing: '-0.02em', fontSize: '1rem' }}>IKF</Typography>
                              <Box className="studio-badge">STUDIO</Box>
                           </Box>
                           <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                              <Typography variant="caption" sx={{ fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em', fontSize: '0.55rem' }}>MailMerge Engine</Typography>
                              <Box sx={{ width: 3, height: 3, borderRadius: '50%', bgcolor: 'var(--surface-border)' }} />
                              <Typography variant="caption" sx={{ fontWeight: 700, color: 'var(--primary)', fontSize: '0.55rem', opacity: 0.8 }}>V2.0</Typography>
                           </Box>
                        </Box>
                    </Box>

                    {/* Centered Navigation */}
                    <nav className="nav-container" style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>
                        {[
                            { path: '/', label: 'Process', icon: <StartIcon sx={{ fontSize: 16 }} /> },
                            { path: '/dashboard', label: 'Monitor', icon: <DashboardIcon sx={{ fontSize: 16 }} /> },
                            { path: '/settings', label: 'Config', icon: <SettingsIcon sx={{ fontSize: 16 }} /> },
                        ].map((item) => (
                            <NavLink 
                                key={item.path} 
                                to={item.path} 
                                className={({ isActive }) => `studio-nav-link ${isActive ? 'active' : ''}`}
                            >
                                <Box display="flex" alignItems="center" gap={1}>
                                    {item.icon}
                                    <Box component="span" sx={{ display: { xs: 'none', md: 'inline' } }}>{item.label}</Box>
                                </Box>
                            </NavLink>
                        ))}
                    </nav>

                    {/* Right Status Area */}
                    <SystemStatusBadge />
                </Container>
            </header>

            <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <Container maxWidth={false} sx={{ px: { xs: 2, md: 6 }, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <Suspense fallback={<Box display="flex" justifyContent="center" py={12}><CircularProgress thickness={5} size={48} /></Box>}>
                        {children}
                    </Suspense>
                </Container>
            </main>

            {!window.location.pathname.includes('process') && (
                <footer style={{ padding: '1rem 0', borderTop: '1px solid var(--surface-divider)', textAlign: 'center' }}>
                    <Typography variant="caption" sx={{ color: 'var(--text-main)', fontWeight: 700, letterSpacing: '0.05em', display: 'block', mb: 0.5 }}>
                        IKF MAILMERGE STUDIO
                    </Typography>
                </footer>
            )}
        </Box>
    );
}

function App() {
    const theme = useMemo(() => createTheme({
        palette: {
            primary: { main: '#1666d3' },
            text: { primary: '#0f172a' },
            background: { default: '#fcfdfe' },
        },
        typography: {
            fontFamily: "'Inter', 'Outfit', sans-serif",
            h4: { fontWeight: 600 },
        },
        shape: { borderRadius: 20 },
    }), []);

    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <BrowserRouter>
                <AppLayout>
                    <Routes>
                        <Route path="/" element={<FileUpload />} />
                        <Route path="/dashboard" element={<Dashboard />} />
                        <Route path="/status/:batchId" element={<Dashboard />} />
                        <Route path="/settings" element={<ConfigurationStudio />} />
                    </Routes>
                </AppLayout>
            </BrowserRouter>
        </ThemeProvider>
    );
}

export default App;
