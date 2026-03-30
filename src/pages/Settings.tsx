import { useState, useEffect } from 'react';
import axios from 'axios';
import Swal from 'sweetalert2';
import {
  Box,
  Typography,
  TextField,
  CircularProgress,
  Button,
  Paper,
  IconButton
} from '@mui/material';
import {
  Visibility,
  VisibilityOff, Dns, Badge, Google
} from '@mui/icons-material';

const API_BASE = '/api';

const Toast = Swal.mixin({
  toast: true,
  position: 'bottom-end',
  showConfirmButton: false,
  timer: 3000,
  timerProgressBar: true,
  background: '#ffffff',
  color: '#0f172a',
  didOpen: (toast) => {
    toast.addEventListener('mouseenter', Swal.stopTimer)
    toast.addEventListener('mouseleave', Swal.resumeTimer)
  }
});

export default function Settings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [, setCheckingGmail] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [gmailStatus, setGmailStatus] = useState({ credentials: false, authenticated: false, status: 'Checking...', has_db_credentials: false });
  const [settings, setSettings] = useState({
    active_provider: 'GMAIL',
    brevo_api_key: '',
    brevo_sender_email: 'noreply@ikf.in',
    brevo_sender_name: 'IKF MailMerge',
    gmail_client_id: '',
    gmail_client_secret: '',
    email_template_subject: 'Follow up regarding {{Company}}',
    email_template_html: '',
    email_template_is_html: false
  });

  useEffect(() => {
    fetchSettings();
    checkGmail();
  }, []);

  const checkGmail = async () => {
    setCheckingGmail(true);
    try {
      const res = await axios.get(`${API_BASE}/check_gmail`);
      setGmailStatus(res.data);
    } catch (err) {
      setGmailStatus({ credentials: false, authenticated: false, status: 'Error checking Gmail status.', has_db_credentials: false });
    } finally {
      setCheckingGmail(false);
    }
  };

  const fetchSettings = async () => {
    try {
      const res = await axios.get(`${API_BASE}/settings`);
      setSettings(res.data);
    } catch (err) {
      Swal.fire({
        icon: 'error',
        title: 'Connection Error',
        text: 'Failed to load system settings.',
        background: '#ffffff',
        color: '#0f172a'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await axios.post(`${API_BASE}/settings`, settings);
      Toast.fire({
        icon: 'success',
        title: 'Settings saved'
      });
      checkGmail();
    } catch (err: any) {
      Swal.fire({
        icon: 'error',
        title: 'Save Failed',
        text: err.response?.data?.detail || 'An unexpected error occurred.',
        background: '#ffffff',
        color: '#0f172a'
      });
    } finally {
      setSaving(false);
    }
  };

  const handleConnectGmail = async () => {
    if (!settings.gmail_client_id || !settings.gmail_client_secret) {
      Swal.fire({
        icon: 'warning',
        title: 'Missing Credentials',
        text: 'Please enter and save your Client ID and Client Secret first.',
        background: '#ffffff',
        color: '#0f172a'
      });
      return;
    }
    setConnecting(true);
    try {
      // Save credentials first
      await axios.post(`${API_BASE}/settings`, {
        gmail_client_id: settings.gmail_client_id,
        gmail_client_secret: settings.gmail_client_secret,
      });
      // Initiate OAuth
      const res = await axios.post(`${API_BASE}/gmail/auth`);
      Toast.fire({
        icon: 'success',
        title: res.data.message || 'Gmail connected!'
      });
      checkGmail();
    } catch (err: any) {
      Swal.fire({
        icon: 'error',
        title: 'Connection Failed',
        text: err.response?.data?.detail || 'OAuth flow failed. Check your credentials.',
        background: '#ffffff',
        color: '#0f172a'
      });
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnectGmail = async () => {
    const result = await Swal.fire({
      title: 'Disconnect Gmail?',
      text: 'This will remove the authentication token. You will need to re-authenticate.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      confirmButtonText: 'Yes, Disconnect',
      background: '#ffffff',
      color: '#0f172a'
    });
    if (!result.isConfirmed) return;
    try {
      await axios.delete(`${API_BASE}/gmail/auth`);
      Toast.fire({
        icon: 'success',
        title: 'Gmail disconnected'
      });
      checkGmail();
    } catch (err: any) {
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: err.response?.data?.detail || 'Failed to disconnect.',
        background: '#ffffff',
        color: '#0f172a'
      });
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" flex={1}>
        <CircularProgress thickness={5} size={48} />
      </Box>
    );
  }

  const statusColor = gmailStatus.authenticated ? 'var(--success)' : (gmailStatus.credentials ? '#f59e0b' : '#94a3b8');

  return (
    <Box className="studio-canvas" sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: 'studioFadeUp 0.8s' }}>
      <Box sx={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', pr: 2, '&::-webkit-scrollbar': { width: '6px' }, '&::-webkit-scrollbar-thumb': { bgcolor: 'var(--surface-divider)', borderRadius: '10px' } }}>
        <Box sx={{ maxWidth: '900px', width: '100%', pt: 2, pb: 8 }}>
          <Box mb={6} sx={{ textAlign: 'center' }}>
            <Box className="hero-eyebrow" sx={{ mb: 2, display: 'inline-block' }}>SYSTEM ARCHITECTURE</Box>
            <Typography variant="h3" sx={{ mb: 1, fontWeight: 800, letterSpacing: '-0.03em' }}>Global Configuration</Typography>
            <Typography variant="body1" sx={{ color: 'var(--text-muted)', fontWeight: 500 }}>Manage your delivery channels and enterprise application protocols.</Typography>
          </Box>

          <Box display="grid" gap={4}>
            {/* Active Provider Section */}
            <Paper variant="outlined" sx={{ p: 4, borderRadius: '28px', border: '1.5px solid var(--surface-divider)', boxShadow: '0 10px 30px rgba(0,0,0,0.02)' }}>
              <Typography variant="subtitle2" sx={{ mb: 3, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1.5, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
                <Dns sx={{ fontSize: 20 }} /> DELIVERY CHANNEL
              </Typography>
              <Box display="flex" gap={2}>
                {['GMAIL', 'BREVO'].map((p) => (
                  <Box
                    key={p}
                    onClick={() => setSettings({ ...settings, active_provider: p })}
                    sx={{
                      flex: 1,
                      p: 3,
                      borderRadius: '20px',
                      border: '2px solid',
                      borderColor: settings.active_provider === p ? 'var(--primary)' : 'var(--surface-border)',
                      bgcolor: settings.active_provider === p ? 'var(--primary-glow)' : 'white',
                      cursor: 'pointer',
                      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                      textAlign: 'center',
                      '&:hover': { transform: 'translateY(-2px)', boxShadow: '0 10px 20px rgba(0,0,0,0.05)' }
                    }}
                  >
                    <Typography variant="h6" sx={{ fontWeight: 900, color: settings.active_provider === p ? 'var(--primary)' : 'var(--text-main)', mb: 0.5 }}>{p}</Typography>
                    <Typography variant="caption" sx={{ fontWeight: 600, color: 'var(--text-muted)' }}>{p === 'GMAIL' ? 'Personal / Workspace' : 'Enterprise SMTP'}</Typography>
                  </Box>
                ))}
              </Box>
            </Paper>

            {/* Brevo Settings */}
            <Paper variant="outlined" sx={{ p: 4, borderRadius: '28px', border: '1.5px solid var(--surface-divider)', boxShadow: '0 10px 30px rgba(0,0,0,0.02)' }}>
              <Typography variant="subtitle2" sx={{ mb: 3, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1.5, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
                <Badge sx={{ fontSize: 20 }} /> BREVO CONFIGURATION
              </Typography>

              <Box display="grid" gap={3}>
                <TextField
                  fullWidth
                  label="Brevo API Key"
                  type="password"
                  variant="filled"
                  value={settings.brevo_api_key}
                  onChange={(e) => setSettings({ ...settings, brevo_api_key: e.target.value })}
                  sx={{ '& .MuiFilledInput-root': { borderRadius: '12px', bgcolor: 'var(--bg-studio)' } }}
                />
                <Box display="grid" gridTemplateColumns="1fr 1fr" gap={2}>
                  <TextField
                    label="Sender Name"
                    variant="filled"
                    value={settings.brevo_sender_name}
                    onChange={(e) => setSettings({ ...settings, brevo_sender_name: e.target.value })}
                    sx={{ '& .MuiFilledInput-root': { borderRadius: '12px', bgcolor: 'var(--bg-studio)' } }}
                  />
                  <TextField
                    label="Sender Email"
                    variant="filled"
                    value={settings.brevo_sender_email}
                    onChange={(e) => setSettings({ ...settings, brevo_sender_email: e.target.value })}
                    sx={{ '& .MuiFilledInput-root': { borderRadius: '12px', bgcolor: 'var(--bg-studio)' } }}
                  />
                </Box>
              </Box>
            </Paper>

            {/* Gmail Settings */}
            <Paper variant="outlined" sx={{ p: 4, borderRadius: '28px', border: '1.5px solid var(--surface-divider)', boxShadow: '0 10px 30px rgba(0,0,0,0.02)' }}>
              <Typography variant="subtitle2" sx={{ mb: 3, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1.5, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
                <Google sx={{ fontSize: 20 }} /> GOOGLE CONSOLE CREDENTIALS
              </Typography>
              <Box display="grid" gap={3}>
                <TextField
                  fullWidth
                  label="Gmail Client ID"
                  variant="filled"
                  value={settings.gmail_client_id}
                  onChange={(e) => setSettings({ ...settings, gmail_client_id: e.target.value })}
                  sx={{ '& .MuiFilledInput-root': { borderRadius: '12px', bgcolor: 'var(--bg-studio)' } }}
                />
                <TextField
                  fullWidth
                  label="Gmail Client Secret"
                  type={showSecret ? 'text' : 'password'}
                  variant="filled"
                  value={settings.gmail_client_secret}
 