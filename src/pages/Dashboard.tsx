import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import {
  Box,
  Typography,
  Grid,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  LinearProgress,
  IconButton,
  Button,
  CircularProgress,
  Fade,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Error as ErrorIcon,
  CheckCircle as SuccessIcon,
  History as HistoryIcon,
  ChevronRight,
  Timeline,
  Visibility,
} from '@mui/icons-material';

const API_BASE = '/api';

export default function Dashboard() {
  const { batch_id: urlBatchId } = useParams();
  const [batches, setBatches] = useState<any[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(urlBatchId || null);
  const [batchInvoices, setBatchInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const res = await axios.get(`${API_BASE}/batches`);
      setBatches(res.data);
      if (!selectedBatchId && res.data.length > 0) {
        setSelectedBatchId(res.data[0].batch_id);
      }
    } catch (err) {}
    finally { setLoading(false); }
  };

  useEffect(() => {
    document.title = "IKF MailMerge | Monitor";
    fetchData();
    const interval = setInterval(fetchData, 8000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (selectedBatchId) {
      axios.get(`${API_BASE}/batches/${selectedBatchId}/invoices`).then(res => {
        setBatchInvoices(res.data);
      });
    }
  }, [selectedBatchId]);

  const activeBatch = useMemo(() => batches.find(b => b.batch_id === selectedBatchId), [batches, selectedBatchId]);

  if (loading && batches.length === 0) {
    return <Box display="flex" justifyContent="center" py={12}><CircularProgress thickness={5} size={48} /></Box>;
  }

  return (
    <Box sx={{ animation: 'studioFadeUp 0.8s' }}>
      <Grid container spacing={6}>
        {/* Left: Operational Ledger */}
        <Grid item xs={12} lg={3}>
           <Box sx={{ position: 'sticky', top: 120 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 4 }}>
                 <Timeline color="primary" sx={{ fontSize: 24 }} />
                 <Typography variant="h6" sx={{ fontWeight: 600 }}>Operational Ledger</Typography>
              </Box>
              
              <Paper variant="outlined" sx={{ borderRadius: '24px', overflow: 'hidden', border: '1.5px solid var(--surface-divider)', bgcolor: 'white' }}>
                 <Box sx={{ p: 2, bgcolor: '#fbfcfd', borderBottom: '1px solid var(--surface-divider)' }}>
                    <Typography variant="caption" sx={{ fontWeight: 500, color: 'var(--text-muted)' }}>HISTORICAL EPOCHS</Typography>
                 </Box>
                 <Box sx={{ maxHeight: '60vh', overflowY: 'auto' }}>
                    {batches.map(b => (
                       <Box 
                        key={b.batch_id} 
                        onClick={() => setSelectedBatchId(b.batch_id)}
                        sx={{ 
                            p: 3, 
                            cursor: 'pointer',
                            borderLeft: '4px solid',
                            borderColor: selectedBatchId === b.batch_id ? 'var(--primary)' : 'transparent',
                            bgcolor: selectedBatchId === b.batch_id ? 'var(--primary-glow)' : 'transparent',
                            transition: 'all 0.2s ease',
                            '&:hover': { bgcolor: selectedBatchId === b.batch_id ? 'var(--primary-glow)' : '#f8fafc' },
                            borderBottom: '1px solid #f1f5f9'
                        }}
                       >
                          <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', mb: 0.5, color: selectedBatchId === b.batch_id ? 'var(--primary)' : 'var(--text-main)' }}>{b.batch_id}</Typography>
                          <Box display="flex" justifyContent="space-between" alignItems="center">
                             <Typography variant="caption" sx={{ fontWeight: 500, color: 'var(--text-muted)' }}>{b.stats?.total} Records</Typography>
                             <Chip label={b.status} size="small" variant="outlined" sx={{ height: 18, fontSize: '0.6rem', fontWeight: 600, textTransform: 'uppercase', borderColor: b.status === 'completed' ? 'var(--success)' : 'var(--primary)', color: b.status === 'completed' ? 'var(--success)' : 'var(--primary)' }} />
                          </Box>
                       </Box>
                    ))}
                 </Box>
              </Paper>
              
              <Box sx={{ mt: 4, p: 3, bgcolor: 'var(--bg-studio)', borderRadius: '20px', border: '1px solid var(--surface-divider)' }}>
                 <Typography variant="caption" sx={{ fontWeight: 600, color: 'var(--text-muted)', display: 'block', mb: 2 }}>GLOBAL CONSISTENCY</Typography>
                 <Box display="flex" alignItems="center" gap={2}>
                    <Typography variant="h4" sx={{ fontWeight: 600 }}>99.8%</Typography>
                    <SuccessIcon sx={{ color: 'var(--success)', fontSize: 24 }} />
                 </Box>
              </Box>
           </Box>
        </Grid>

        {/* Right: Deep Dive Intelligence */}
        <Grid item xs={12} lg={9}>
           {activeBatch ? (
             <Fade in={true} timeout={500}>
                <Box>
                   <Box display="flex" justifyContent="space-between" alignItems="center" mb={6}>
                      <Box>
                         <Typography variant="h4" sx={{ fontWeight: 600, mb: 1 }}>Epoch Deep Dive</Typography>
                         <Typography variant="body2" sx={{ color: 'var(--text-muted)', fontWeight: 500 }}>Active audit for batch <span style={{ color: 'var(--text-main)' }}>{activeBatch.batch_id}</span> via <span style={{ color: 'var(--primary)' }}>{activeBatch.provider?.toUpperCase() || 'SMTP'}</span></Typography>
                      </Box>
                      <Button variant="contained" className="btn-studio" startIcon={<RefreshIcon />} onClick={fetchData} sx={{ px: 4 }}>Sync Intel</Button>
                   </Box>

                   <Grid container spacing={4} mb={6}>
                      {[
                        { label: 'SUCCESS YIELD', val: activeBatch.stats?.success || 0, color: 'var(--success)', icon: <SuccessIcon /> },
                        { label: 'FAILURE LOGS', val: activeBatch.stats?.failed || 0, color: 'var(--error)', icon: <ErrorIcon /> },
                        { label: 'PENDING TASKS', val: activeBatch.stats?.pending || 0, color: 'var(--text-muted)', icon: <HistoryIcon /> },
                      ].map(s => (
                        <Grid item xs={12} md={4} key={s.label}>
                           <Paper variant="outlined" sx={{ p: 4, borderRadius: '28px', border: '2px solid var(--surface-divider)', bgcolor: 'white' }}>
                              <Box display="flex" justifyContent="space-between" mb={2}>
                                 <Typography variant="caption" sx={{ fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>{s.label}</Typography>
                                 <Box sx={{ color: s.color }}>{s.icon}</Box>
                              </Box>
                              <Typography variant="h3" sx={{ fontWeight: 600 }}>{s.val}</Typography>
                           </Paper>
                        </Grid>
                      ))}
                   </Grid>

                   <Box sx={{ mb: 8, p: 4, bgcolor: '#fbfcfd', borderRadius: '32px', border: '1px solid var(--surface-divider)' }}>
                      <Box display="flex" justifyContent="space-between" mb={2}>
                         <Typography variant="caption" sx={{ fontWeight: 600 }}>Dispatch Velocity</Typography>
                         <Typography variant="caption" sx={{ fontWeight: 600 }}>{((activeBatch.stats?.success + activeBatch.stats?.failed) / activeBatch.stats?.total * 100).toFixed(1)}% Complete</Typography>
                      </Box>
                      <LinearProgress variant="determinate" value={((activeBatch.stats?.success + activeBatch.stats?.failed) / activeBatch.stats?.total) * 100} sx={{ height: 12, borderRadius: 999, bgcolor: 'white', border: '1px solid var(--surface-divider)', '& .MuiLinearProgress-bar': { borderRadius: 999 } }} />
                   </Box>

                   <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 3, display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Visibility sx={{ fontSize: 18 }} /> High-Precision Dispatch Logs
                   </Typography>
                   <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: '24px', overflow: 'hidden', border: '1.5px solid var(--surface-divider)', boxShadow: 'none' }}>
                      <Table>
                         <TableHead sx={{ bgcolor: '#fbfcfd' }}>
                            <TableRow>
                               <TableCell sx={{ fontWeight: 500, py: 3, pl: 4 }}>RECIPIENT IDENTITY</TableCell>
                               <TableCell sx={{ fontWeight: 500 }}>FINANCIAL PAYLOAD</TableCell>
                               <TableCell sx={{ fontWeight: 500 }}>OPERATIONAL STATUS</TableCell>
                               <TableCell align="right" sx={{ fontWeight: 500, pr: 4 }}>DIAGNOSTICS</TableCell>
                            </TableRow>
                         </TableHead>
                         <TableBody>
                            {batchInvoices.map((inv) => (
                               <TableRow key={inv.id} hover sx={{ '&:last-child td, &:last-child th': { border: 0 } }}>
                                  <TableCell sx={{ pl: 4 }}>
                                     <Typography variant="body2" sx={{ fontWeight: 600 }}>{inv.client_name}</Typography>
                                     <Typography variant="caption" sx={{ color: 'var(--text-muted)', fontWeight: 500 }}>{inv.email_address}</Typography>
                                  </TableCell>
                                  <TableCell>
                                     <Typography variant="body2" sx={{ fontWeight: 500 }}>ID: {inv.invoice_number}</Typography>
                                     <Typography variant="caption" sx={{ color: 'var(--primary)', fontWeight: 600 }}>$ {inv.amount.toLocaleString()}</Typography>
                                  </TableCell>
                                  <TableCell>
                                     <Chip 
                                       label={inv.status} 
                                       size="small" 
                                       sx={{ 
                                          fontWeight: 600, 
                                          fontSize: '0.6rem', 
                                          textTransform: 'uppercase', 
                                          bgcolor: inv.status === 'sent' ? 'var(--success-glow)' : inv.status === 'failed' ? 'var(--error-glow)' : '#f1f5f9',
                                          color: inv.status === 'sent' ? 'var(--success)' : inv.status === 'failed' ? 'var(--error)' : 'var(--text-muted)',
                                          border: `1px solid ${inv.status === 'sent' ? 'var(--success)' : inv.status === 'failed' ? 'var(--error)' : '#e2e8f0'}`
                                       }} 
                                     />
                                  </TableCell>
                                  <TableCell align="right" sx={{ pr: 4 }}>
                                     <IconButton size="small" sx={{ bgcolor: 'var(--bg-studio)', '&:hover': { bgcolor: 'var(--primary-glow)', color: 'var(--primary)' } }}><ChevronRight sx={{ fontSize: 18 }} /></IconButton>
                                  </TableCell>
                               </TableRow>
                            ))}
                         </TableBody>
                      </Table>
                   </TableContainer>
                </Box>
             </Fade>
           ) : (
             <Box sx={{ py: 20, textAlign: 'center', bgcolor: 'var(--bg-studio)', borderRadius: '40px', border: '1.5px dashed var(--surface-divider)' }}>
                <HistoryIcon sx={{ fontSize: 48, color: 'var(--text-muted)', mb: 2, opacity: 0.3 }} />
                <Typography variant="h6" sx={{ fontWeight: 800, color: 'var(--text-muted)' }}>Select an Epoch for Intel</Typography>
             </Box>
           )}
        </Grid>
      </Grid>
    </Box>
  );
}
