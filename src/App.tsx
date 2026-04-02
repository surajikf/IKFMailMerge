import { lazy, Suspense, useState, useEffect, useMemo } from 'react';
import { BrowserRouter, Routes, Route, NavLink, useLocation, Navigate } from 'react-router-dom';
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
  Button,
  Chip,
  Menu,
  MenuItem,
  Avatar,
} from '@mui/material';
import {
  AddCircleOutline as StartIcon,
  Dashboard as DashboardIcon,
  Settings as SettingsIcon,
  PeopleAlt as UsersIcon,
  Logout as LogoutIcon,
  KeyboardArrowDown as ArrowDownIcon,
} from '@mui/icons-material';

import FileUpload from './pages/FileUpload';
import ConfigurationStudio from './pages/ConfigurationStudio';
import LoginPage from './pages/LoginPage';
import UserManagement from './pages/UserManagement';
import ProtectedRoute from './components/ProtectedRoute';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import './index.css';

const Dashboard = lazy(() => import('./pages/Dashboard'));

const SystemStatusBadge = () => {
    const [status, setStatus] = useState<{ provider: string | null, smtp: string | null }>({ provider: null, smtp: null });
    const { token } = useAuth();
    
    useEffect(() => {
        if (!token) return;
        const fetchStatus = () => {
            axios.get('/api/settings').then(res => {
                setStatus({ provider: res.data.active_provider, smtp: res.data.active_smtp_name });
            }).catch(() => {});
        };
        fetchStatus();
        const interval = setInterval(fetchStatus, 30000);
        return () => clearInterval(interval);
    }, [token]);

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
                px: 2.25, 
                py: 0.9,
                bgcolor: isActive ? 'rgba(236, 253, 245, 0.95)' : 'rgba(248, 250, 252, 0.95)',
                borderRadius: '999px',
                border: '1px solid',
                borderColor: isActive ? 'rgba(16, 185, 129, 0.28)' : 'rgba(226, 232, 240, 0.95)',
                boxShadow: '0 2px 10px rgba(15, 23, 42, 0.04), inset 0 1px 0 rgba(255,255,255,0.85)',
                cursor: 'default',
                transition: 'all 0.3s ease',
                '&:hover': { transform: 'translateY(-1px)', boxShadow: '0 4px 14px rgba(15, 23, 42, 0.07)' }
            }}>
                <Box className={isActive ? "status-pulse" : ""} sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: isActive ? 'var(--success)' : 'var(--text-muted)' }} />
                <Typography variant="caption" sx={{ fontWeight: 700, color: isActive ? '#0f172a' : '#64748b', letterSpacing: '0.04em', fontSize: { xs: '0.68rem', md: '0.72rem' } }}>
                    {label}
                </Typography>
            </Box>
        </Tooltip>
    );
};

const UserMenu = () => {
    const { user, logout } = useAuth();
    const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

    if (!user) return null;

    return (
        <>
            <Chip
                avatar={<Avatar sx={{ width: 24, height: 24, bgcolor: '#1666d3', fontSize: '0.7rem' }}>{user.email[0].toUpperCase()}</Avatar>}
                label={user.email.split('@')[0]}
                deleteIcon={<ArrowDownIcon sx={{ fontSize: '16px !important' }} />}
                onDelete={(e) => setAnchorEl(e.currentTarget)}
                onClick={(e) => setAnchorEl(e.currentTarget)}
                sx={{
                    fontWeight: 700,
                    fontSize: '0.78rem',
                    bgcolor: 'rgba(241, 245, 249, 0.95)',
                    border: '1px solid rgba(226, 232, 240, 0.9)',
                    cursor: 'pointer',
                    '&:hover': { bgcolor: '#fff' },
                    display: { xs: 'none', md: 'flex' },
                }}
            />
            <Menu
                anchorEl={anchorEl}
                open={Boolean(anchorEl)}
                onClose={() => setAnchorEl(null)}
                PaperProps={{ sx: { mt: 1, borderRadius: 2, border: '1px solid #e2e8f0', boxShadow: '0 8px 32px rgba(15,23,42,0.1)' } }}
            >
                <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid #f1f5f9' }}>
                    <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block' }}>Signed in as</Typography>
                    <Typography variant="body2" fontWeight={700} sx={{ color: '#0f172a' }}>{user.email}</Typography>
                    <Chip label={user.role} size="small" sx={{ mt: 0.5, height: 18, fontSize: '0.65rem', fontWeight: 700, textTransform: 'capitalize', bgcolor: user.role === 'admin' ? '#eff6ff' : '#f1f5f9', color: user.role === 'admin' ? '#1666d3' : '#475569' }} />
                </Box>
                <MenuItem onClick={() => { logout(); setAnchorEl(null); }} sx={{ gap: 1.5, color: '#dc2626', fontWeight: 600, py: 1.5 }}>
                    <LogoutIcon fontSize="small" />
                    Sign Out
                </MenuItem>
            </Menu>
        </>
    );
};

const AppLayout = ({ children }: { children: React.ReactNode }) => {
    const [scrolled, setScrolled] = useState(false);
    const { user } = useAuth();
    const location = useLocation();
    
    useEffect(() => {
        const routeMap: Record<string, string> = {
            '/': 'Email Builder',
            '/dashboard': 'Email Status',
            '/settings': 'Settings',
            '/users': 'User Management',
        };
        const title = routeMap[location.pathname] || 'MailMerge Studio';
        document.title = `IKF | ${title}`;
    }, [location.pathname]);

    useEffect(() => {
        const handleError = (e: ErrorEvent) => {
            console.error("Studio Runtime Exception:", e.error);
        };
        window.addEventListener('error', handleError);
        const handleScroll = () => setScrolled(window.scrollY > 20);
        window.addEventListener('scroll', handleScroll, { passive: true });
        return () => {
            window.removeEventListener('error', handleError);
            window.removeEventListener('scroll', handleScroll);
        };
    }, []);

    return (
        <Box className="animate-up" sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
            <header className={`studio-header ${scrolled ? 'scrolled' : ''}`}>
                <Container maxWidth={false} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: { xs: 2, md: 6 } }}>
                    {/* Logo Area */}
                    <Box 
                        onClick={() => { window.location.href = '/'; }}
                        sx={{ 
                            textDecoration: 'none', 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: 2, 
                            cursor: 'pointer',
                            '&:hover img': { transform: 'scale(1.1) rotate(-3deg)' }
                        }}
                    >
                        <Box 
                            component="img" 
                            src="/ikf.png" 
                            alt="IKF Logo" 
                            sx={{ 
                                height: { xs: 24, md: 32 }, 
                                width: 'auto',
                                filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.05))',
                                transition: 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)'
                            }} 
                        />
                        <Box sx={{ borderLeft: '2px solid rgba(226, 232, 240, 0.95)', pl: 2, display: 'flex', alignItems: 'center' }}>
                           <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#0f172a', lineHeight: 1.1, letterSpacing: '-0.03em', fontSize: { xs: '1.05rem', md: '1.15rem' } }}>
                              IKF Mail Merge
                           </Typography>
                        </Box>
                    </Box>

                    {/* Centered Navigation */}
                    {user && (
                        <nav className="nav-container" style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>
                            {[
                                { path: '/', label: 'Build', icon: <StartIcon sx={{ fontSize: 18, opacity: 0.92 }} /> },
                                { path: '/dashboard', label: 'Status', icon: <DashboardIcon sx={{ fontSize: 18, opacity: 0.92 }} /> },
                                { path: '/settings', label: 'Settings', icon: <SettingsIcon sx={{ fontSize: 18, opacity: 0.92 }} /> },
                                ...(user.role === 'admin' ? [{ path: '/users', label: 'Users', icon: <UsersIcon sx={{ fontSize: 18, opacity: 0.92 }} /> }] : []),
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
                    )}

                    {/* Right Status & Action Area */}
                    <Box display="flex" alignItems="center" gap={2}>
                        {user && (
                            <Button
                                onClick={() => { window.location.href = '/'; }}
                                sx={{
                                    color: '#1e293b',
                                    fontSize: { xs: '0.72rem', md: '0.78rem' },
                                    fontWeight: 700,
                                    textTransform: 'none',
                                    letterSpacing: '0.02em',
                                    borderRadius: '999px',
                                    border: 'none',
                                    px: 2.25,
                                    py: 1,
                                    display: { xs: 'none', lg: 'flex' },
                                    gap: 1,
                                    bgcolor: 'rgba(241, 245, 249, 0.95)',
                                    boxShadow: '0 2px 12px rgba(15, 23, 42, 0.06), inset 0 1px 0 rgba(255,255,255,0.9)',
                                    transition: 'all 0.25s ease',
                                    '&:hover': { 
                                        bgcolor: '#fff',
                                        boxShadow: '0 4px 18px rgba(22, 102, 211, 0.12)',
                                        transform: 'translateY(-1px)',
                                    },
                                }}
                            >
                                <StartIcon sx={{ fontSize: 18, color: 'var(--primary)', opacity: 0.95 }} />
                                Start new
                            </Button>
                        )}
                        <SystemStatusBadge />
                        <UserMenu />
                    </Box>
                </Container>
            </header>

            <main className="studio-viewport" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <Container maxWidth={false} sx={{ px: { xs: 2, md: 6 }, flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <Suspense fallback={<Box display="flex" justifyContent="center" py={12}><CircularProgress thickness={5} size={48} /></Box>}>
                        {children}
                    </Suspense>
                </Container>
            </main>

            {!window.location.pathname.includes('process') && (
                <footer style={{ padding: '1rem 0', borderTop: '1px solid var(--surface-divider)', textAlign: 'center' }}>
                    <Typography variant="caption" sx={{ color: 'var(--text-main)', fontWeight: 700, letterSpacing: '0.05em', display: 'block', mb: 0.5 }}>
                        IKF MAIL MERGE
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
                <AuthProvider>
                    <AppLayout>
                        <Routes>
                            {/* Public route */}
                            <Route path="/auth" element={<LoginPage />} />
                            
                            {/* Protected routes */}
                            <Route path="/" element={<ProtectedRoute><FileUpload /></ProtectedRoute>} />
                            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
                            <Route path="/status/:batchId" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
                            <Route path="/settings" element={<ProtectedRoute><ConfigurationStudio /></ProtectedRoute>} />
                            <Route path="/users" element={<ProtectedRoute requireAdmin><UserManagement /></ProtectedRoute>} />
                            
                            {/* Catch-all */}
                            <Route path="*" element={<Navigate to="/" replace />} />
                        </Routes>
                    </AppLayout>
                </AuthProvider>
            </BrowserRouter>
        </ThemeProvider>
    );
}

export default App;

