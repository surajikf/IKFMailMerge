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
  FiberManualRecord as StatusIcon,
} from '@mui/icons-material';

import FileUpload from './pages/FileUpload';
import ConfigurationStudio from './pages/ConfigurationStudio';
import './index.css';

const Dashboard = lazy(() => import('./pages/Dashboard'));

const SystemHealthDot = () => {
    const [provider, setProvider] = useState<string | null>(null);
    useEffect(() => {
        axios.get('/api/settings').then(res => setProvider(res.data.active_provider)).catch(() => {});
    }, []);

    return (
        <Tooltip title={provider ? `Live via ${provider}` : 'System Standby'}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'help' }}>
                <StatusIcon sx={{ fontSize: 10, color: provider ? 'var(--success)' : 'var(--text-muted)', filter: provider ? 'drop-shadow(0 0 4px var(--success))' : 'none' }} />
                <Typography variant="caption" sx={{ fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {provider || 'Ready'}
                </Typography>
            </Box>
        </Tooltip>
    );
};

const AppLayout = ({ children }: { children: React.ReactNode }) => {
    return (
        <Box className="animate-up" sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
            <header className="studio-header">
                <Container maxWidth={false} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: { xs: 2, md: 6 } }}>
                    {/* Logo Area */}
                    <Box component={Link} to="/" sx={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Box 
                            component="img" 
                            src="/ikf.png" 
                            alt="IKF Logo" 
                            sx={{ 
                                height: 32, 
                                width: 'auto',
                                filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.05))',
                                transition: 'transform 0.2s ease',
                                '&:hover': { transform: 'scale(1.05)' }
                            }} 
                        />
                        <Box sx={{ borderLeft: '1.5px solid var(--surface-divider)', pl: 2 }}>
                           <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'var(--text-main)', lineHeight: 1, letterSpacing: '-0.02em' }}>IKF</Typography>
                           <Typography variant="caption" sx={{ fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em', fontSize: '0.6rem' }}>MailMerge</Typography>
                        </Box>
                    </Box>

                    {/* Centered Navigation */}
                    <nav className="nav-container">
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
                                    {item.label}
                                </Box>
                            </NavLink>
                        ))}
                    </nav>

                    {/* Right Status Area */}
                    <SystemHealthDot />
                </Container>
            </header>

            <main style={{ flex: 1, padding: '2rem 0' }}>
                <Container maxWidth={false} sx={{ px: { xs: 2, md: 6 } }}>
                    <Suspense fallback={<Box display="flex" justifyContent="center" py={12}><CircularProgress thickness={5} size={48} /></Box>}>
                        {children}
                    </Suspense>
                </Container>
            </main>

            <footer style={{ padding: '4rem 0', borderTop: '1px solid var(--surface-divider)', textAlign: 'center' }}>
                <Typography variant="caption" sx={{ color: 'var(--text-main)', fontWeight: 700, letterSpacing: '0.05em', display: 'block', mb: 1 }}>
                    IKF MAILMERGE STUDIO · ENTERPRISE EDITION
                </Typography>
                <Typography variant="caption" sx={{ color: 'var(--text-muted)', fontWeight: 500, display: 'block', mb: 1 }}>
                    © 2026 I Knowledge Factory Pvt. Ltd. · All Rights Reserved
                </Typography>
                <Typography variant="caption" sx={{ color: 'var(--text-muted)', fontWeight: 500, opacity: 0.4 }}>
                    SYSTEM VERSION 5.5.3 · STABLE BUILT WITH PRECISION
                </Typography>
            </footer>
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
