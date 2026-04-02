import { useState, useEffect } from 'react';
import axios from 'axios';
import Swal from 'sweetalert2';
import {
  Box,
  Typography,
  Paper,
  TextField,
  Button,
  Grid,
  Card,
  CardContent,
  Container,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
  IconButton,
  Chip,
} from '@mui/material';
import {
  Google as GoogleIcon,
  Email as EmailIcon,
  Add as AddIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  CheckCircle as CheckCircleIcon,
  Lan as LanIcon,
} from '@mui/icons-material';
import { extractApiError } from '../utils/api';

const API_BASE = '/api';

const Toast = Swal.mixin({
  toast: true,
  position: 'top-end',
  showConfirmButton: false,
  timer: 3000,
  timerProgressBar: true,
  background: '#ffffff',
  color: '#0f172a',
});

interface SettingsData {
  active_provider: 'GMAIL' | 'BREVO' | 'SMTP' | 'GMAIL_SMTP';
  brevo_api_key: string;
  brevo_sender_email: string;
  brevo_sender_name: string;
  email_template_subject: string;
  email_template_html: string;
  active_template_type: 'PROFESSIONAL' | 'CREATIVE';
}

interface SmtpAccount {
  id: number;
  display_name: string;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  is_active: boolean;
}

export default function ConfigurationStudio() {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [smtpAccounts, setSmtpAccounts] = useState<SmtpAccount[]>([]);
  const [loading, setLoading] = useState(true);

  // SMTP Dialog State
  const [smtpDialogOpen, setSmtpDialogOpen] = useState(false);
  const [editingSmtp, setEditingSmtp] = useState<Partial<SmtpAccount & { smtp_password?: string }> | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; message: string } | null>(null);

  const fetchSettings = async () => {
    try {
      const [settingsRes, smtpRes] = await Promise.all([
        axios.get(`${API_BASE}/settings`),
        axios.get(`${API_BASE}/smtp_accounts`),
      ]);
      setSettings(settingsRes.data);
      setSmtpAccounts(smtpRes.data);
    } catch (err) {
      const apiError = extractApiError(err, 'Failed to load settings.');
      Toast.fire({ icon: 'error', title: apiError.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    document.title = "IKF MailMerge | Settings";
    fetchSettings();
  }, []);

  const handleSaveSettings = async (overrides?: Partial<SettingsData>) => {
    if (!settings) return;
    const dataToSave = overrides ? { ...settings, ...overrides } : settings;
    try {
      await axios.post(`${API_BASE}/settings`, dataToSave);
      Toast.fire({ icon: 'success', title: 'Saved.' });
      if (overrides) {
        setSettings(prev => prev ? { ...prev, ...overrides } : null);
      } else {
        fetchSettings();
      }
    } catch (err) {
      const apiError = extractApiError(err, 'Could not save.');
      Swal.fire({ icon: 'error', title: 'Error', text: apiError.message });
    }
  };

  const handleConnectGmail = async () => {
    try {
      const res = await axios.post(`${API_BASE}/gmail/auth`);
      if (res.data.auth_url) window.location.href = res.data.auth_url;
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'Connection failed', text: extractApiError(err).message });
    }
  };

  const handleDisconnectGmail = async () => {
    try {
      await axios.delete(`${API_BASE}/gmail/auth`);
      Toast.fire({ icon: 'success', title: 'Gmail disconnected' });
      fetchSettings();
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'Action Failed', text: extractApiError(err).message });
    }
  };

  const handleSmtpAction = async (action: 'add' | 'edit' | 'delete' | 'activate', id?: number) => {
    try {
      if (action === 'delete' && id) {
        const confirm = await Swal.fire({ title: 'Delete account?', text: 'This cannot be undone.', icon: 'warning', showCancelButton: true });
        if (!confirm.isConfirmed) return;
        await axios.delete(`${API_BASE}/smtp_accounts/${id}`);
      } else if (action === 'activate' && id) {
        await axios.post(`${API_BASE}/smtp_accounts/${id}/activate`);
      } else if (action === 'add' || action === 'edit') {
        if (!editingSmtp) return;
        if (action === 'add') await axios.post(`${API_BASE}/smtp_accounts`, editingSmtp);
        else await axios.put(`${API_BASE}/smtp_accounts/${id}`, editingSmtp);
        setSmtpDialogOpen(false);
      }
      fetchSettings();
      Toast.fire({ icon: 'success', title: 'Done.' });
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'Error', text: extractApiError(err).message });
    }
  };

  const handleVerifyConnection = async () => {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const res = await axios.get(`${API_BASE}/settings/verify`);
      setVerifyResult(res.data);
      if (res.data.ok) {
        Toast.fire({ icon: 'success', title: 'Connection verified', text: res.data.message });
      } else {
        Swal.fire({ icon: 'error', title: 'Verification failed', text: res.data.message });
      }
    } catch (err) {
      const apiErr = extractApiError(err);
      setVerifyResult({ ok: false, message: apiErr.message });
      Swal.fire({ icon: 'error', title: 'System error', text: apiErr.message });
    } finally {
      setVerifying(false);
    }
  };

  if (loading || !settings) {
    return (
      <Box display="flex" justifyContent="center" py={12}><CircularProgress thickness={5} size={48} /></Box>
    );
  }

  const isProviderActive = (id: string) => {
     if (settings.active_provider === id) return true;
     if (id === 'SMTP' && settings.active_provider === 'GMAIL_SMTP') return true;
     return false;
  };

  return (
    <Container
      maxWidth="xl"
      sx={{
        width: '100%',
        animation: 'studioFadeUp 0.8s cubic-bezier(0.16, 1, 0.3, 1)',
        px: { xs: 2, sm: 3, md: 4 },
        py: { xs: 2, md: 3 },
      }}
    >
      <Box sx={{ mb: { xs: 4, md: 5 } }}>
        <Typography variant="h5" sx={{ mb: 1, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--text-main)' }}>
          Settings
        </Typography>
        <Typography variant="body1" sx={{ color: 'var(--text-muted)', fontWeight: 400, maxWidth: 720 }}>
          Choose your email provider and connection details.
        </Typography>
      </Box>

      {/* Primary Channel Selection — uses full content width */}
      <Grid container spacing={2.5} sx={{ mb: { xs: 4, md: 5 } }}>
         {[
            { id: 'SMTP', label: 'SMTP', icon: <LanIcon />, desc: 'Use your SMTP server' },
            { id: 'BREVO', label: 'Brevo', icon: <EmailIcon />, desc: 'Use Brevo API' },
            { id: 'GMAIL', label: 'Gmail', icon: <GoogleIcon />, desc: 'Connect with Google' },
         ].map((p) => (
            <Grid item xs={12} sm={6} lg={4} key={p.id}>
               <Box 
                onClick={() => handleSaveSettings({ active_provider: p.id as any })}
                sx={{ 
                    p: { xs: 2.5, md: 3.5 }, 
                    minHeight: { md: 148 },
                    borderRadius: 3, 
                    cursor: 'pointer', 
                    border: '1px solid',
                    borderColor: isProviderActive(p.id) ? 'var(--primary)' : 'var(--surface-border)',
                    bgcolor: isProviderActive(p.id) ? 'var(--primary-glow)' : '#fff',
                    boxShadow: isProviderActive(p.id) ? '0 8px 28px rgba(22, 102, 211, 0.08)' : '0 1px 3px rgba(15, 23, 42, 0.06)',
                    transition: 'all 0.25s ease',
                    textAlign: 'center',
                    position: 'relative',
                    overflow: 'hidden',
                    '&:hover': {
                      borderColor: 'var(--primary)',
                      boxShadow: '0 6px 24px rgba(15, 23, 42, 0.07)',
                    }
                }}
               >
                  {isProviderActive(p.id) && (
                    <Box sx={{ position: 'absolute', top: 12, right: 12 }}>
                      <Box className="pulse-dot" sx={{ bgcolor: verifyResult?.ok ? 'var(--success)' : (verifyResult === null ? 'var(--primary)' : 'var(--error)') }} />
                    </Box>
                  )}
                  <Box sx={{ mb: 1.5, color: isProviderActive(p.id) ? 'var(--primary)' : 'var(--text-muted)', '& svg': { fontSize: 36 } }}>{p.icon}</Box>
                  <Typography variant="subtitle1" sx={{ fontWeight: 500, color: isProviderActive(p.id) ? 'var(--text-main)' : 'var(--text-muted)' }}>{p.label}</Typography>
                  <Typography variant="body2" sx={{ color: 'var(--text-muted)', fontWeight: 400, mt: 0.5 }}>{p.desc}</Typography>
               </Box>
            </Grid>
         ))}
      </Grid>

      <Paper
        className="studio-card"
        sx={{
          p: { xs: 3, sm: 4, md: 5 },
          width: '100%',
          borderRadius: 3,
        }}
      >
          <Box>
            {settings.active_provider === 'GMAIL' && (
              <Box textAlign="center" py={{ xs: 2, md: 4 }} px={{ xs: 0, sm: 2 }}>
                <GoogleIcon sx={{ fontSize: 56, color: '#ea4335', mb: 2 }} />
                <Typography variant="h6" sx={{ fontWeight: 500, mb: 1 }}>Connect Gmail</Typography>
                <Typography variant="body2" sx={{ color: 'var(--text-muted)', fontWeight: 400, mb: 4, maxWidth: 480, mx: 'auto' }}>
                  Connect your Gmail account securely using Google sign-in.
                </Typography>
                <Box display="flex" justifyContent="center" gap={2} flexWrap="wrap">
                  <Button variant="contained" className="btn-studio" onClick={handleConnectGmail} sx={{ fontWeight: 500, textTransform: 'none' }}>Connect Gmail</Button>
                  <Button variant="outlined" className="btn-studio-outline" sx={{ borderRadius: 999, fontWeight: 500, textTransform: 'none' }} onClick={handleDisconnectGmail}>Disconnect</Button>
                </Box>
              </Box>
            )}

            {settings.active_provider === 'BREVO' && (
              <Box display="grid" gap={4}>
                <TextField fullWidth label="Brevo API Key (v3)" type="password" value={settings.brevo_api_key || ''} onChange={(e) => setSettings({ ...settings, brevo_api_key: e.target.value })} />
                <Box display="grid" gridTemplateColumns={{ xs: '1fr', sm: '1fr 1fr' }} gap={2}>
                  <TextField fullWidth label="Sender Display Name" value={settings.brevo_sender_name || ''} onChange={(e) => setSettings({ ...settings, brevo_sender_name: e.target.value })} />
                  <TextField fullWidth label="Sender Email Address" value={settings.brevo_sender_email || ''} onChange={(e) => setSettings({ ...settings, brevo_sender_email: e.target.value })} />
                </Box>
                <Button variant="contained" className="btn-studio" onClick={() => handleSaveSettings()} sx={{ fontWeight: 500, textTransform: 'none', alignSelf: 'flex-start' }}>Save settings</Button>
              </Box>
            )}

            {settings.active_provider === 'SMTP' && (
              <Grid container spacing={{ xs: 3, lg: 4 }}>
                <Grid item xs={12} lg={8}>
                <Box display="flex" justifyContent="space-between" mb={2.5} alignItems="flex-start" flexWrap="wrap" gap={1.5}>
                  <Box>
                    <Typography variant="subtitle1" sx={{ fontWeight: 500 }}>SMTP Accounts</Typography>
                    <Typography variant="body2" sx={{ color: 'var(--text-muted)', fontWeight: 400, mt: 0.5 }}>
                      One account can be active at a time.
                    </Typography>
                  </Box>
                  <Button size="small" startIcon={<AddIcon />} sx={{ fontWeight: 500, textTransform: 'none' }} onClick={() => { setEditingSmtp({ smtp_port: 465, smtp_host: 'smtp.gmail.com' }); setSmtpDialogOpen(true); }}>Add account</Button>
                </Box>
                <Box sx={{ mb: 2, p: 1.75, borderRadius: 2, bgcolor: 'var(--bg-studio)', border: '1px solid var(--surface-divider)' }}>
                  <Typography variant="body2" sx={{ fontWeight: 400, color: 'var(--text-muted)' }}>
                    Current active: <Box component="span" sx={{ color: 'var(--text-main)' }}>{smtpAccounts.find((a) => a.is_active)?.display_name || 'None selected'}</Box>
                  </Typography>
                </Box>
                <Box display="grid" gap={2}>
                  {smtpAccounts.map(acc => (
                    <Card
                      key={acc.id}
                      onClick={() => { if (!acc.is_active) handleSmtpAction('activate', acc.id); }}
                      sx={{
                        borderRadius: 2,
                        border: '1px solid',
                        borderColor: acc.is_active ? 'var(--primary)' : 'var(--surface-divider)',
                        boxShadow: 'none',
                        bgcolor: acc.is_active ? 'var(--primary-glow)' : 'white',
                        cursor: acc.is_active ? 'default' : 'pointer',
                        '&:hover': acc.is_active ? {} : { borderColor: 'var(--primary)' },
                      }}
                    >
                      <CardContent sx={{ p: 2.5, display: 'flex', alignItems: 'center', gap: 2.5, flexWrap: 'wrap' }}>
                        <Box sx={{ p: 1.5, bgcolor: acc.is_active ? 'var(--primary-glow)' : 'var(--surface-divider)', borderRadius: '12px' }}>
                           <LanIcon sx={{ color: acc.is_active ? 'var(--primary)' : 'var(--text-muted)' }} />
                        </Box>
                        <Box flex={1} sx={{ minWidth: 200 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.4, flexWrap: 'wrap' }}>
                            <Typography variant="body2" sx={{ fontWeight: 500 }}>{acc.display_name}</Typography>
                            {acc.is_active && <Chip size="small" label="Active" color="success" sx={{ height: 22, fontWeight: 500, fontSize: '0.7rem' }} />}
                          </Box>
                          <Typography variant="body2" sx={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.8125rem' }}>
                            {acc.smtp_user} · {acc.smtp_host}
                          </Typography>
                        </Box>
                        <Box display="flex" gap={1} flexShrink={0}>
                          {acc.is_active ? (
                            <Button size="small" variant="contained" color="success" disabled sx={{ minWidth: 88, borderRadius: 999, fontWeight: 500, textTransform: 'none' }}>
                              Active
                            </Button>
                          ) : (
                            <Button
                              size="small"
                              variant="outlined"
                              onClick={(e) => { e.stopPropagation(); handleSmtpAction('activate', acc.id); }}
                              startIcon={<CheckCircleIcon fontSize="small" />}
                              sx={{ minWidth: 96, borderRadius: 999, fontWeight: 500, textTransform: 'none' }}
                            >
                              Use this
                            </Button>
                          )}
                          <IconButton size="small" onClick={(e) => { e.stopPropagation(); setEditingSmtp(acc); setSmtpDialogOpen(true); }}><EditIcon fontSize="small" /></IconButton>
                          <IconButton size="small" color="error" onClick={(e) => { e.stopPropagation(); handleSmtpAction('delete', acc.id); }}><DeleteIcon fontSize="small" /></IconButton>
                        </Box>
                      </CardContent>
                    </Card>
                  ))}
                </Box>
                </Grid>
                <Grid item xs={12} lg={4}>
                  <Box
                    sx={{
                      p: 2.5,
                      borderRadius: 2,
                      border: '1px dashed var(--surface-border)',
                      bgcolor: 'rgba(248, 250, 252, 0.8)',
                      height: '100%',
                      minHeight: { lg: 200 },
                    }}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 500, color: 'var(--text-main)', mb: 1 }}>
                      Tips
                    </Typography>
                    <Typography variant="body2" sx={{ color: 'var(--text-muted)', fontWeight: 400, lineHeight: 1.6 }}>
                      After you save or switch accounts, run Check connection below. Gmail often uses port 465 (SSL) or 587 (TLS).
                    </Typography>
                  </Box>
                </Grid>
              </Grid>
            )}
            
            <Box sx={{ mt: 5, pt: 4, borderTop: '1px solid var(--surface-divider)', display: 'flex', justifyContent: 'flex-start' }}>
              <Button 
                startIcon={verifying ? <CircularProgress size={16} color="inherit" /> : <CheckCircleIcon />} 
                className="btn-studio" 
                onClick={handleVerifyConnection}
                disabled={verifying}
                sx={{ px: 3, fontWeight: 500, textTransform: 'none' }}
              >
                {verifying ? 'Checking...' : 'Check connection'}
              </Button>
            </Box>
          </Box>
      </Paper>

      {/* SMTP Edit Dialog */}
      <Dialog open={smtpDialogOpen} onClose={() => setSmtpDialogOpen(false)} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: '28px', p: 1 } }}>
        <DialogTitle sx={{ fontWeight: 500, pb: 0 }}>{editingSmtp?.id ? 'Edit SMTP account' : 'Add SMTP account'}</DialogTitle>
        <DialogContent sx={{ mt: 3, display: 'grid', gap: 3 }}>
          <TextField fullWidth label="Account Name" value={editingSmtp?.display_name || ''} onChange={e => setEditingSmtp({...editingSmtp, display_name: e.target.value})} />
          <Box display="grid" gridTemplateColumns="2.5rem 1fr 5rem" gap={1.5}>
             <Box sx={{ alignSelf: 'center', textAlign: 'center' }}><LanIcon color="disabled" /></Box>
             <TextField label="Host" placeholder="smtp.gmail.com" value={editingSmtp?.smtp_host || ''} onChange={e => setEditingSmtp({...editingSmtp, smtp_host: e.target.value})} />
             <TextField label="Port" type="number" value={editingSmtp?.smtp_port || 465} onChange={e => setEditingSmtp({...editingSmtp, smtp_port: parseInt(e.target.value)})} />
          </Box>
          <TextField label="SMTP Username" value={editingSmtp?.smtp_user || ''} onChange={e => setEditingSmtp({...editingSmtp, smtp_user: e.target.value})} />
          <TextField label="SMTP Password" type="password" value={editingSmtp?.smtp_password || ''} onChange={e => setEditingSmtp({...editingSmtp, smtp_password: e.target.value})} />
        </DialogContent>
        <DialogActions sx={{ p: 4 }}>
          <Button onClick={() => setSmtpDialogOpen(false)} sx={{ fontWeight: 500, textTransform: 'none' }}>Cancel</Button>
          <Button variant="contained" className="btn-studio" sx={{ fontWeight: 500, textTransform: 'none' }} onClick={() => handleSmtpAction(editingSmtp?.id ? 'edit' : 'add', editingSmtp?.id)}>
            {editingSmtp?.id ? 'Save account' : 'Add account'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
