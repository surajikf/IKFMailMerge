import { useState, useEffect } from 'react';
import axios from 'axios';
import Swal from 'sweetalert2';
import {
  Box,
  Typography,
  Paper,
  Tabs,
  Tab,
  TextField,
  Button,
  Grid,
  Card,
  CardContent,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
  IconButton,
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
  const [tabIndex, setTabIndex] = useState(0);
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [smtpAccounts, setSmtpAccounts] = useState<SmtpAccount[]>([]);
  const [loading, setLoading] = useState(true);

  // SMTP Dialog State
  const [smtpDialogOpen, setSmtpDialogOpen] = useState(false);
  const [editingSmtp, setEditingSmtp] = useState<Partial<SmtpAccount & { smtp_password?: string }> | null>(null);

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
    document.title = "IKF MailMerge | Configuration";
    fetchSettings();
  }, []);

  const handleSaveSettings = async () => {
    if (!settings) return;
    try {
      await axios.post(`${API_BASE}/settings`, settings);
      Toast.fire({ icon: 'success', title: 'Configured.' });
      fetchSettings();
    } catch (err) {
      const apiError = extractApiError(err, 'Failed to save.');
      Swal.fire({ icon: 'error', title: 'Error', text: apiError.message });
    } finally {
    }
  };

  const handleConnectGmail = async () => {
    try {
      const res = await axios.post(`${API_BASE}/gmail/auth`);
      if (res.data.auth_url) window.location.href = res.data.auth_url;
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'Connection Failed', text: extractApiError(err).message });
    }
  };

  const handleDisconnectGmail = async () => {
    try {
      await axios.delete(`${API_BASE}/gmail/auth`);
      Toast.fire({ icon: 'success', title: 'Gmail disconnected.' });
      fetchSettings();
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'Action Failed', text: extractApiError(err).message });
    }
  };

  const handleSmtpAction = async (action: 'add' | 'edit' | 'delete' | 'activate', id?: number) => {
    try {
      if (action === 'delete' && id) {
        const confirm = await Swal.fire({ title: 'Delete Account?', text: 'This cannot be undone.', icon: 'warning', showCancelButton: true });
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
      Toast.fire({ icon: 'success', title: 'Success.' });
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'Error', text: extractApiError(err).message });
    }
  };

  if (loading || !settings) {
    return (
      <Box display="flex" justifyContent="center" py={12}><CircularProgress thickness={5} size={48} /></Box>
    );
  }

  return (
    <Box sx={{ maxWidth: '100%', mx: 'auto', animation: 'studioFadeUp 0.8s cubic-bezier(0.16, 1, 0.3, 1)' }}>
      <Box sx={{ mb: 6, textAlign: 'center' }}>
        <Typography variant="h4" sx={{ mb: 1, fontWeight: 900 }}>System Configuration</Typography>
        <Typography variant="body2" sx={{ color: 'var(--text-muted)', fontWeight: 700 }}>
           Manage your intelligence channels and delivery protocols.
        </Typography>
      </Box>

      {/* Primary Channel Selection (Horizontal Grid) */}
      <Grid container spacing={2} sx={{ mb: 6 }}>
         {[
            { id: 'GMAIL', label: 'Gmail Pro', icon: <GoogleIcon />, desc: 'Native OAuth Access' },
            { id: 'BREVO', label: 'Brevo API', icon: <EmailIcon />, desc: 'High-Scale Transactional' },
            { id: 'SMTP', label: 'SMTP Bridge', icon: <LanIcon />, desc: 'Custom Protocols' },
         ].map((p) => (
            <Grid item xs={12} md={4} key={p.id}>
               <Box 
                onClick={() => setSettings({ ...settings, active_provider: p.id as any })}
                sx={{ 
                    p: 3, 
                    borderRadius: '24px', 
                    cursor: 'pointer', 
                    border: '1.5px solid',
                    borderColor: settings.active_provider === p.id ? 'var(--primary)' : 'var(--surface-border)',
                    bgcolor: settings.active_provider === p.id ? 'var(--primary-glow)' : 'var(--surface)',
                    transition: 'all 0.2s ease',
                    textAlign: 'center'
                }}
               >
                  <Box sx={{ mb: 1.5, color: settings.active_provider === p.id ? 'var(--primary)' : 'var(--text-muted)' }}>{p.icon}</Box>
                  <Typography variant="body2" sx={{ fontWeight: 900 }}>{p.label}</Typography>
                  <Typography variant="caption" sx={{ color: 'var(--text-muted)', fontWeight: 700 }}>{p.desc}</Typography>
               </Box>
            </Grid>
         ))}
      </Grid>

      <Paper className="studio-card" sx={{ p: 0, overflow: 'hidden' }}>
        <Tabs value={tabIndex} onChange={(_: any, v: number) => setTabIndex(v)} sx={{ borderBottom: '1px solid var(--surface-divider)', px: 4, pt: 1 }}>
          <Tab label="Connection" sx={{ textTransform: 'none', fontWeight: 800, px: 3 }} />
          <Tab label="Defaults" sx={{ textTransform: 'none', fontWeight: 800, px: 3 }} />
        </Tabs>

        <Box sx={{ p: 5 }}>
          {tabIndex === 0 && (
            <Box>
              {settings.active_provider === 'GMAIL' && (
                <Box textAlign="center" py={4}>
                  <GoogleIcon sx={{ fontSize: 64, color: '#ea4335', mb: 3 }} />
                  <Typography variant="h6" sx={{ fontWeight: 900, mb: 1 }}>Google Direct Link</Typography>
                  <Typography variant="body2" sx={{ color: 'var(--text-muted)', mb: 4, maxWidth: 400, mx: 'auto' }}>
                    Connect your workspace securely. IKF uses bank-level OAuth protocols to manage outreach without password storage.
                  </Typography>
                  <Box display="flex" justifyContent="center" gap={2}>
                    <Button variant="contained" className="btn-studio" onClick={handleConnectGmail}>Link Google Workspace</Button>
                    <Button variant="outlined" className="btn-studio-outline" sx={{ borderRadius: 999 }} onClick={handleDisconnectGmail}>Deactivate</Button>
                  </Box>
                </Box>
              )}

              {settings.active_provider === 'BREVO' && (
                <Box display="grid" gap={4}>
                  <TextField fullWidth label="Brevo API Key (v3)" type="password" value={settings.brevo_api_key || ''} onChange={(e) => setSettings({ ...settings, brevo_api_key: e.target.value })} />
                  <Box display="grid" gridTemplateColumns="1fr 1fr" gap={2}>
                    <TextField fullWidth label="Sender Display Name" value={settings.brevo_sender_name || ''} onChange={(e) => setSettings({ ...settings, brevo_sender_name: e.target.value })} />
                    <TextField fullWidth label="Sender Email Address" value={settings.brevo_sender_email || ''} onChange={(e) => setSettings({ ...settings, brevo_sender_email: e.target.value })} />
                  </Box>
                  <Button variant="contained" className="btn-studio" onClick={handleSaveSettings}>Update Channel Configuration</Button>
                </Box>
              )}

              {settings.active_provider === 'SMTP' && (
                <Box>
                  <Box display="flex" justifyContent="space-between" mb={3} alignItems="center">
                    <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>Network Nodes</Typography>
                    <Button size="small" startIcon={<AddIcon />} sx={{ fontWeight: 800 }} onClick={() => { setEditingSmtp({ smtp_port: 465, smtp_host: 'smtp.gmail.com' }); setSmtpDialogOpen(true); }}>Register Node</Button>
                  </Box>
                  <Box display="grid" gap={2}>
                    {smtpAccounts.map(acc => (
                      <Card key={acc.id} sx={{ borderRadius: '18px', border: '1px solid var(--surface-divider)', boxShadow: 'none' }}>
                        <CardContent sx={{ p: 2.5, display: 'flex', alignItems: 'center', gap: 2.5 }}>
                          <Box sx={{ p: 1.5, bgcolor: acc.is_active ? 'var(--primary-glow)' : 'var(--surface-divider)', borderRadius: '12px' }}>
                             <LanIcon sx={{ color: acc.is_active ? 'var(--primary)' : 'var(--text-muted)' }} />
                          </Box>
                          <Box flex={1}>
                            <Typography variant="body2" sx={{ fontWeight: 900 }}>{acc.display_name}</Typography>
                            <Typography variant="caption" sx={{ color: 'var(--text-muted)', fontWeight: 700 }}>{acc.smtp_user} Â· {acc.smtp_host}</Typography>
                          </Box>
                          <Box display="flex" gap={1}>
                            {!acc.is_active && <IconButton size="small" onClick={() => handleSmtpAction('activate', acc.id)}><CheckCircleIcon fontSize="small" /></IconButton>}
                            <IconButton size="small" onClick={() => { setEditingSmtp(acc); setSmtpDialogOpen(true); }}><EditIcon fontSize="small" /></IconButton>
                            <IconButton size="small" color="error" onClick={() => handleSmtpAction('delete', acc.id)}><DeleteIcon fontSize="small" /></IconButton>
                          </Box>
                        </CardContent>
                      </Card>
                    ))}
                  </Box>
                </Box>
              )}
            </Box>
          )}

          {tabIndex === 1 && (
            <Box display="grid" gap={4}>
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 900, mb: 2 }}>Universal Subject Logic</Typography>
                <TextField fullWidth placeholder="Enter default outreach subject..." value={settings.email_template_subject} onChange={(e) => setSettings({ ...settings, email_template_subject: e.target.value })} />
                <Typography variant="caption" sx={{ color: 'var(--text-muted)', mt: 1, display: 'block', fontWeight: 700 }}>Use high-conversion variables like {"{{Name}}"}, {"{{Amount}}"}</Typography>
              </Box>
              
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 900, mb: 2 }}>Artistic Branding Direction</Typography>
                <Box display="flex" gap={2}>
                  {['PROFESSIONAL', 'CREATIVE'].map(type => (
                    <Box
                      key={type}
                      onClick={() => setSettings({ ...settings, active_template_type: type as any })}
                      sx={{
                        flex: 1, p: 3, borderRadius: '20px', cursor: 'pointer', border: '1.5px solid',
                        borderColor: settings.active_template_type === type ? 'var(--primary)' : 'var(--surface-border)',
                        bgcolor: settings.active_template_type === type ? 'var(--primary-glow)' : 'transparent',
                        textAlign: 'center'
                      }}
                    >
                      <Typography variant="body2" sx={{ fontWeight: 900 }}>{type}</Typography>
                    </Box>
                  ))}
                </Box>
              </Box>
              
              <Button variant="contained" className="btn-studio" sx={{ mt: 2 }} onClick={handleSaveSettings}>Save Studio Defaults</Button>
            </Box>
          )}
        </Box>
      </Paper>

      {/* SMTP Edit Dialog */}
      <Dialog open={smtpDialogOpen} onClose={() => setSmtpDialogOpen(false)} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: '28px', p: 1 } }}>
        <DialogTitle sx={{ fontWeight: 900, pb: 0 }}>Register Node</DialogTitle>
        <DialogContent sx={{ mt: 3, display: 'grid', gap: 3 }}>
          <TextField fullWidth label="Node Display Name" value={editingSmtp?.display_name || ''} onChange={e => setEditingSmtp({...editingSmtp, display_name: e.target.value})} />
          <Box display="grid" gridTemplateColumns="2.5rem 1fr 5rem" gap={1.5}>
             <Box sx={{ alignSelf: 'center', textAlign: 'center' }}><LanIcon color="disabled" /></Box>
             <TextField label="Host" placeholder="smtp.gmail.com" value={editingSmtp?.smtp_host || ''} onChange={e => setEditingSmtp({...editingSmtp, smtp_host: e.target.value})} />
             <TextField label="Port" type="number" value={editingSmtp?.smtp_port || 465} onChange={e => setEditingSmtp({...editingSmtp, smtp_port: parseInt(e.target.value)})} />
          </Box>
          <TextField label="Node Authenticator (User)" value={editingSmtp?.smtp_user || ''} onChange={e => setEditingSmtp({...editingSmtp, smtp_user: e.target.value})} />
          <TextField label="Secure Protocol (Password)" type="password" value={editingSmtp?.smtp_password || ''} onChange={e => setEditingSmtp({...editingSmtp, smtp_password: e.target.value})} />
        </DialogContent>
        <DialogActions sx={{ p: 4 }}>
          <Button onClick={() => setSmtpDialogOpen(false)} sx={{ fontWeight: 800 }}>Cancel</Button>
          <Button variant="contained" className="btn-studio" onClick={() => handleSmtpAction(editingSmtp?.id ? 'edit' : 'add', editingSmtp?.id)}>Activate Node</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
