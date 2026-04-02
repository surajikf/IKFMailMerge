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
} from '@mui/material';
import {
  Dns, Badge, Google
} from '@mui/icons-material';
import { Grid, Chip } from '@mui/material';

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
    // Senior QA Resilience: Malformed Guard
    if (settings.active_provider === 'BREVO' && settings.brevo_api_key.length < 10) {
       Swal.fire({ icon: 'warning', title: 'Invalid API Key', text: 'The Brevo API key appears malformed or too short.' });
       setSaving(false);
       return;
    }

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
    <Box sx={{ animation: 'studioFadeUp 0.8s', maxWidth: 1000, mx: 'auto', p: 4 }}>
      <Box sx={{ mb: 6, display: 'flex', alignItems: 'center', gap: 2 }}>
         <Dns color="primary" sx={{ fontSize: 32 }} />
         <Box>
            <Typography variant="h4" sx={{ fontWeight: 900, letterSpacing: '-0.04em' }}>Email Settings</Typography>
            <Typography variant="body2" sx={{ color: 'var(--text-muted)', fontWeight: 600 }}>Set sender name, sender email, and Gmail connection.</Typography>
         </Box>
      </Box>

      <Grid container spacing={4}>
         {/* 1. Identity Architecture */}
         <Grid item xs={12} md={6}>
            <Paper variant="outlined" sx={{ p: 4, borderRadius: '24px', border: '1.5px solid var(--surface-divider)', height: '100%', bgcolor: 'white', boxShadow: 'var(--studio-shadow-sm)', transition: 'all 0.3s ease', '&:hover': { borderColor: 'var(--primary)', transform: 'translateY(-4px)' } }}>
               <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 4 }}>
                  <Badge color="primary" />
                  <Typography variant="h6" sx={{ fontWeight: 800 }}>Sender Details</Typography>
               </Box>
               <TextField 
                  fullWidth 
                  label="Display Name" 
                  variant="filled"
                  value={settings.brevo_sender_name} 
                  onChange={e => setSettings({ ...settings, brevo_sender_name: e.target.value })} 
                  sx={{ mb: 3, '& .MuiFilledInput-root': { borderRadius: '12px', bgcolor: 'var(--bg-studio)' } }} 
               />
               <TextField 
                  fullWidth 
                  label="Sender Email" 
                  variant="filled"
                  value={settings.brevo_sender_email} 
                  onChange={e => setSettings({ ...settings, brevo_sender_email: e.target.value })} 
                  sx={{ mb: 3, '& .MuiFilledInput-root': { borderRadius: '12px', bgcolor: 'var(--bg-studio)' } }} 
               />
               <Typography variant="caption" sx={{ color: 'var(--text-muted)', fontWeight: 500, display: 'block', mt: 1 }}>
                  Recipients will see this name and email.
               </Typography>
            </Paper>
         </Grid>

         {/* 2. Connectivity Protocols (Gmail API) */}
         <Grid item xs={12} md={6}>
            <Paper variant="outlined" sx={{ p: 4, borderRadius: '24px', border: '1.5px solid var(--surface-divider)', height: '100%', bgcolor: 'white', boxShadow: 'var(--studio-shadow-sm)', transition: 'all 0.3s ease', '&:hover': { borderColor: 'var(--primary)', transform: 'translateY(-4px)' } }}>
               <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 4 }}>
                  <Google color="primary" />
                  <Typography variant="h6" sx={{ fontWeight: 800 }}>Gmail Connection</Typography>
               </Box>
               
               <Box sx={{ p: 3, bgcolor: 'var(--bg-studio)', borderRadius: '20px', mb: 4, border: '1px solid var(--surface-divider)' }}>
                  <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                     <Typography variant="caption" sx={{ fontWeight: 900, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>CONNECTION STATUS</Typography>
                     <Chip 
                        label={gmailStatus.authenticated ? 'ACTIVE' : 'INACTIVE'} 
                        size="small" 
                        color={gmailStatus.authenticated ? 'success' : 'default'} 
                        sx={{ height: 20, fontSize: '0.6rem', fontWeight: 900, borderRadius: '6px' }} 
                     />
                  </Box>
                  <Typography variant="body1" sx={{ fontWeight: 800, color: gmailStatus.authenticated ? 'var(--success)' : 'var(--text-main)', letterSpacing: '-0.01em' }}>
                     {gmailStatus.status}
                  </Typography>
               </Box>

               {gmailStatus.authenticated ? (
                  <Button 
                     fullWidth 
                     variant="outlined" 
                     color="error"
                     size="large"
                     onClick={handleDisconnectGmail}
                     sx={{ py: 1.8, borderRadius: '16px', fontWeight: 900, border: '2px solid' }}
                  >
                     Disconnect Gmail
                  </Button>
               ) : (
                  <Button 
                     fullWidth 
                     variant="contained" 
                     className="btn-studio"
                     size="large"
                     startIcon={connecting ? <CircularProgress size={18} color="inherit" /> : <Google />}
                     onClick={async () => {
                        setConnecting(true);
                        try { const res = await axios.post(`${API_BASE}/gmail/auth`); window.location.href = res.data.url; }
                        catch(err) { Toast.fire({ icon: 'error', title: 'Auth Link Failed' }); }
                        finally { setConnecting(false); }
                     }}
                     disabled={connecting}
                     sx={{ py: 1.8, borderRadius: '16px', fontWeight: 900 }}
                  >
                     {connecting ? 'Connecting...' : 'Connect Gmail'}
                  </Button>
               )}
            </Paper>
         </Grid>

         {/* 3. Global Orchestration Footer */}
         <Grid item xs={12}>
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
               <Button 
                  variant="contained" 
                  className="btn-studio" 
                  size="large"
                  onClick={handleSave} 
                  disabled={saving}
                  sx={{ minWidth: 280, py: 2.2, fontSize: '1.1rem', fontWeight: 900, borderRadius: '20px', boxShadow: `0 15px 35px ${statusColor}44` }}
               >
                  {saving ? <CircularProgress size={22} color="inherit" /> : 'Save Settings'}
               </Button>
            </Box>
         </Grid>
      </Grid>
    </Box>
  );
}
