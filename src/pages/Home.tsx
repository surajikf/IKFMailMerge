import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  Box,
  Typography,
  Button,
  Grid,
  Paper,
  CircularProgress,
} from '@mui/material';
import {
  AddCircleOutline as LaunchIcon,
  AutoAwesome as Sparkles,
  ChevronRight,
  TrendingUp,
} from '@mui/icons-material';

export default function Home() {
  const navigate = useNavigate();

  useEffect(() => {
    document.title = "IKF MailMerge | Home";
  }, []);
  const [stats, setStats] = useState({ total_sent: 0, loading: true });

  useEffect(() => {
    // Analytics/Stats logic if needed
    axios.get('/api/batches').then(res => {
        const total = res.data.reduce((acc: number, b: any) => acc + (b.stats?.success || 0), 0);
        setStats({ total_sent: total, loading: false });
    }).catch(() => setStats({ total_sent: 0, loading: false }));
  }, []);

  return (
    <Box sx={{ animation: 'studioFadeUp 0.8s cubic-bezier(0.16, 1, 0.3, 1)' }}>
      {/* Immersive Hero Canvas */}
      <Box className="hero-canvas" sx={{ py: 12 }}>
         <Box className="hero-eyebrow" sx={{ mb: 4 }}>
            <Sparkles fontSize="small" /> 
            Easy Email Sending
         </Box>
         
         <Typography className="hero-title" variant="h1" sx={{ maxWidth: 800, mx: 'auto', mb: 3 }}>
            Send reminder emails <span style={{ color: 'var(--primary)' }}>quickly and clearly.</span>
         </Typography>
         
         <Typography variant="body1" sx={{ color: 'var(--text-muted)', maxWidth: 600, mx: 'auto', mb: 6, fontSize: '1.25rem', lineHeight: 1.6 }}>
            Upload your file, write your email, preview it, and send.
         </Typography>

         <Box sx={{ display: 'flex', justifyContent: 'center', gap: 2 }}>
            <Button 
                variant="contained" 
                className="btn-studio" 
                onClick={() => navigate('/campaign')}
                startIcon={<LaunchIcon />}
                sx={{ px: 6, py: 2, fontSize: '1.1rem' }}
            >
                Start New Email
            </Button>
            <Button 
                variant="outlined" 
                className="btn-studio-outline" 
                onClick={() => navigate('/dashboard')}
                sx={{ borderRadius: 999, px: 4, fontWeight: 500 }}
            >
                View Status
            </Button>
         </Box>
      </Box>

      {/* Concise Intelligence Cards */}
      <Grid container spacing={4} sx={{ mt: 4 }}>
         <Grid item xs={12} md={6}>
            <Paper className="studio-card" sx={{ p: 4, position: 'relative' }}>
               <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={4}>
                  <Box>
                     <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5 }}>Emails Sent</Typography>
                     <Typography variant="caption" sx={{ color: 'var(--text-muted)', fontWeight: 500, textTransform: 'uppercase' }}>TOTAL SENT</Typography>
                  </Box>
                  <TrendingUp color="primary" sx={{ fontSize: 32, opacity: 0.2 }} />
               </Box>
               
               {stats.loading ? <CircularProgress size={24} /> : (
                  <Typography variant="h3" sx={{ fontWeight: 600, mb: 1 }}>{stats.total_sent.toLocaleString()}</Typography>
               )}
               <Typography variant="body2" sx={{ color: 'var(--text-muted)' }}>Total emails sent from this app.</Typography>
               
               <Box mt={4}>
                  <Button endIcon={<ChevronRight />} onClick={() => navigate('/dashboard')} sx={{ fontWeight: 500, p: 0 }}>View Full History</Button>
               </Box>
            </Paper>
         </Grid>

         <Grid item xs={12} md={6}>
            <Paper className="studio-card" sx={{ p: 4 }}>
               <Box>
                  <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5 }}>System Status</Typography>
                  <Typography variant="caption" sx={{ color: 'var(--text-muted)', fontWeight: 500, textTransform: 'uppercase' }}>CURRENT STATE</Typography>
               </Box>
               
               <Box sx={{ mt: 4, display: 'grid', gap: 2.5 }}>
                  {[
                    { label: 'Server Connection', status: 'Good' },
                    { label: 'Security', status: 'On' },
                    { label: 'SMTP Bridge', status: 'Active' },
                  ].map((s) => (
                    <Box key={s.label} display="flex" justifyContent="space-between" alignItems="center">
                       <Typography variant="body2" sx={{ fontWeight: 500 }}>{s.label}</Typography>
                       <Box display="flex" alignItems="center" gap={1}>
                          <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'var(--success)' }} />
                          <Typography variant="caption" sx={{ color: 'var(--success)', fontWeight: 500 }}>{s.status}</Typography>
                       </Box>
                    </Box>
                  ))}
               </Box>

               <Box mt={4}>
                  <Button endIcon={<ChevronRight />} onClick={() => navigate('/settings')} sx={{ fontWeight: 500, p: 0 }}>Open Settings</Button>
               </Box>
            </Paper>
         </Grid>
      </Grid>
    </Box>
  );
}
