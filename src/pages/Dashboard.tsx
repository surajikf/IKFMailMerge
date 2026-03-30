import { useState, useEffect, useMemo, useCallback } from 'react';
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
  const [batches, setBatches] = useState<any[]>([]); // Array of BatchSummary { batch, stats }
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(urlBatchId || null);
  const [batchInvoices, setBatchInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE}/batches`);
      setBatches(res.data || []);
      // If we don't have a selection, pick the first one from the list
      if (!selectedBatchId && res.data.length > 0) {
        setSelectedBatchId(res.data[0].batch.batch_id);
      }
    } catch (err) {
      console.error("Ledger fetch failed:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedBatchId]);

  useEffect(() => {
    document.title = "IKF MailMerge | Monitor";
    fetchData();
    const interval = setInterval(fetchData, 8000);
    return () => clearInterval(interval);
  }, [fetchData]);

  useEffect(() => {
    if (selectedBatchId) {
      // Fetch invoices using the new status endpoint
      axios.get(`${API_BASE}/status/${selectedBatchId}`).then(res => {
        setBatchInvoices(res.data || []);
      }).catch(err => console.error("Invoice fetch failed:", err));
    }
  }, [selectedBatchId]);

  // Memoize the active batch summary
  const activeBatchSummary = useMemo(() => batches.find(b => b.batch.batch_id === selectedBatchId), [batches, selectedBatchId]);

  if (loading && batches.length === 0) {
    return <Box display="flex" justifyContent="center" py={12}><CircularProgress thickness={5} size={48} /></Box>;
  }

  const columns = [
    { id: 'recipient_name', label: 'RECIPIENT IDENTITY' },
    { id: 'invoice_amount', label: 'FINANCIAL PAYLOAD' },
    { id: 'status', label: 'OPERATIONAL STATUS' },
    { id: 'diagnostics', label: 'DIAGNOSTICS' },
  ];

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
              
               <Paper variant="outlined" sx={{ borderRadius: '24px', overflow: 'hidden', border: '1.5px solid var(--surface-divider)', bgcolor: 'white', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                  <Box sx={{ p: 2, bgcolor: '#fbfcfd', borderBottom: '1px solid var(--surface-divider)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                     <Typography variant="caption" sx={{ fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>HISTORICAL EPOCHS</Typography>
                     <RefreshIcon sx={{ fontSize: 14, color: 'var(--text-muted)', opacity: 0.5 }} />
                  </Box>
                  <Box sx={{ maxHeight: '55vh', overflowY: 'auto', '&::-webkit-scrollbar': { width: 4 }, '&::-webkit-scrollbar-thumb': { bgcolor: 'var(--surface-divider)', borderRadius: 10 } }}>
                     {batches.map(b => (
                        <Box 
                         key={b.batch.batch_id} 
                         onClick={() => setSelectedBatchId(b.batch.batch_id)}
                         sx={{ 
                             p: 2.5, 
                             cursor: 'pointer',
                             borderLeft: '4px solid',
                             borderColor: selectedBatchId === b.batch.batch_id ? 'var(--primary)' : 'transparent',
                             bgcolor: selectedBatchId === b.batch.batch_id ? 'var(--primary-glow)' : 'transparent',
                             transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                             '&:hover': { bgcolor: selectedBatchId === b.batch.batch_id ? 'var(--primary-glow)' : '#f8fafc' },
                             borderBottom: '1px solid #f1f5f9'
                         }}
                        >
                           <Box display="flex" justifyContent="space-between" alignItems="start" mb={1}>
                              <Typography variant="caption" sx={{ fontWeight: 800, fontSize: '0.65rem', color: selectedBatchId === b.batch.batch_id ? 'var(--primary)' : 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%', letterSpacing: '-0.01em' }}>
                                 {b.batch.batch_id.split('-')[0].toUpperCase()} ... {b.batch.batch_id.slice(-6).toUpperCase()}
                              </Typography>
                              <Chip 
                                 label={b.batch.status} 
                                 size="small" 
                                 sx={{ 
                                    height: 16, 
                                    fontSize: '0.55rem', 
                                    fontWeight: 900, 
                                    textTransform: 'uppercase', 
                                    bgcolor: b.batch.status === 'completed' ? 'var(--success-glow)' : 'var(--primary-glow)',
                                    color: b.batch.status === 'completed' ? 'var(--success)' : 'var(--primary)',
                                    border: 'none'
                                 }} 
                              />
                           </Box>
                           <Box display="flex" justifyContent="space-between" alignItems="center">
                              <Typography variant="caption" sx={{ fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.6rem' }}>{b.stats?.total || 0} RECORDS</Typography>
                              <Typography variant="caption" sx={{ fontWeight: 700, color: 'var(--text-main)', fontSize: '0.6rem' }}>{new Date(b.batch.created_at || Date.now()).toLocaleDateString()}</Typography>
                           </Box>
                        </Box>
                     ))}
                    {batches.length === 0 && (
                      <Box sx={{ p: 4, textAlign: 'center' }}>
                         <Typography variant="caption" sx={{ color: 'var(--text-muted)' }}>No batches generated yet.</Typography>
                      </Box>
                    )}
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
           {activeBatchSummary ? (
             <Fade in={true} timeout={500}>
                <Box>
                   <Box display="flex" justifyContent="space-between" alignItems="center" mb={6}>
                      <Box>
                         <Typography variant="h4" sx={{ fontWeight: 600, mb: 1 }}>Epoch Deep Dive</Typography>
                         <Typography variant="body2" sx={{ color: 'var(--text-muted)', fontWeight: 500 }}>Active audit for batch <span style={{ color: 'var(--text-main)' }}>{activeBatchSummary.batch.batch_id}</span> via <span style={{ color: 'var(--primary)' }}>{activeBatchSummary.batch.provider?.toUpperCase() || 'SMTP'}</span></Typography>
                      </Box>
                      <Button variant="contained" className="btn-studio" startIcon={<RefreshIcon />} onClick={fetchData} sx={{ px: 4 }}>Sync Intel</Button>
                   </Box>

                   <Grid container spacing={3} mb={4}>
                      {[
                        { label: 'SUCCESS YIELD', val: activeBatchSummary.stats?.success || 0, color: 'var(--success)', icon: <SuccessIcon />, class: 'success' },
                        { label: 'FAILURE LOGS', val: activeBatchSummary.stats?.failed || 0, color: 'var(--error)', icon: <ErrorIcon />, class: 'error' },
                        { label: 'PENDING TASKS', val: activeBatchSummary.stats?.pending || 0, color: 'var(--text-muted)', icon: <HistoryIcon />, class: 'pending' },
                      ].map(s => (
                        <Grid item xs={12} md={4} key={s.label}>
                           <Paper className={`status-tile ${s.class}`} sx={{ p: 3, borderRadius: '24px', bgcolor: 'white', position: 'relative', overflow: 'hidden' }}>
                              <Box display="flex" justifyContent="space-between" mb={1}>
                                 <Typography variant="caption" sx={{ fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.1em', fontSize: '0.65rem' }}>{s.label}</Typography>
                                 <Box sx={{ color: s.color, opacity: 0.8 }}>{s.icon}</Box>
                              </Box>
                              <Typography variant="h3" sx={{ fontWeight: 900, color: 'var(--text-main)', letterSpacing: '-0.03em' }}>{s.val}</Typography>
                              {s.class === 'success' && s.val > 0 && <Box sx={{ position: 'absolute', bottom: -10, right: -10, opacity: 0.05, transform: 'rotate(-15deg)' }}><SuccessIcon sx={{ fontSize: 80 }} /></Box>}
                           </Paper>
                        </Grid>
                      ))}
                   </Grid>

                   <Box sx={{ mb: 6, p: 3, bgcolor: '#ffffff', borderRadius: '24px', border: '1.5px solid var(--surface-divider)', boxShadow: '0 2px 8px rgba(0,0,0,0.01)' }}>
                      <Box display="flex" justifyContent="space-between" mb={2}>
                         <Box display="flex" alignItems="center" gap={1}>
                            <Typography variant="caption" sx={{ fontWeight: 800, color: 'var(--text-main)', letterSpacing: '0.05em' }}>DISPATCH VELOCITY</Typography>
                            {activeBatchSummary.stats?.pending > 0 && <Box className="pulse-dot" sx={{ bgcolor: 'var(--primary)', width: 6, height: 6 }} />}
                         </Box>
                         <Box sx={{ textAlign: 'right' }}>
                            <Typography variant="caption" sx={{ fontWeight: 900, color: 'var(--primary)' }}>
                              {activeBatchSummary.stats?.total > 0 
                                ? (((activeBatchSummary.stats.success + activeBatchSummary.stats.failed) / activeBatchSummary.stats.total) * 100).toFixed(1)
                                : 0}% COMPLETE
                            </Typography>
                            {activeBatchSummary.stats?.pending > 0 && (
                               <Typography variant="caption" sx={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.6rem', fontWeight: 600 }}>
                                  EST. COMPLETION: ~{Math.ceil(activeBatchSummary.stats.pending * 0.1)} MIN
                               </Typography>
                            )}
                         </Box>
                      </Box>
                      <Box className={activeBatchSummary.stats?.pending > 0 ? 'progress-pulse' : ''} sx={{ borderRadius: 999 }}>
                         <LinearProgress 
                           variant="determinate" 
                           value={activeBatchSummary.stats?.total > 0 ? (((activeBatchSummary.stats.success + activeBatchSummary.stats.failed) / activeBatchSummary.stats.total) * 100) : 0} 
                           sx={{ height: 10, borderRadius: 999, bgcolor: 'var(--surface-divider)', '& .MuiLinearProgress-bar': { borderRadius: 999, transition: 'all 0.6s ease' } }} 
                         />
                      </Box>
                   </Box>

                    <Box sx={{ p: 0.5 }}>
                       <Typography variant="caption" sx={{ fontWeight: 800, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
                          <Visibility sx={{ fontSize: 16 }} /> HIGH-PRECISION DISPATCH LOGS
                       </Typography>
                       <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: '20px', overflow: 'hidden', border: '1.5px solid var(--surface-divider)', boxShadow: 'none' }}>
                          <Table size="small">
                             <TableHead sx={{ bgcolor: '#fbfcfd' }}>
                                <TableRow>
                                   {columns.map(col => (
                                     <TableCell key={col.id} sx={{ fontWeight: 800, py: 2, fontSize: '0.65rem', borderBottom: '1px solid var(--surface-divider)', pl: col.id === 'recipient_name' ? 3 : 2 }}>{col.label}</TableCell>
                                   ))}
                                </TableRow>
                             </TableHead>
                             <TableBody>
                                {batchInvoices.map((inv) => {
                                   let rowData: any = {};
                                   try { rowData = JSON.parse(inv.row_data || '{}'); } catch(e) {}
                                   const friendlyId = rowData['Invoice Number'] || rowData['invoice_number'] || rowData['ID'] || inv.id;
    
                                   return (
                                    <TableRow key={inv.id} hover sx={{ '&:last-child td, &:last-child th': { border: 0 }, transition: 'all 0.2s ease' }}>
                                       <TableCell sx={{ pl: 3, py: 2 }}>
                                          <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.85rem' }}>{inv.recipient_name}</Typography>
                                          <Typography variant="caption" sx={{ color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.7rem' }}>{inv.email_address}</Typography>
                                       </TableCell>
                                       <TableCell>
                                          <Box sx={{ borderLeft: '3px solid var(--primary-glow)', pl: 1.5 }}>
                                             <Typography variant="caption" sx={{ fontWeight: 800, display: 'block', color: 'var(--text-muted)', fontSize: '0.6rem' }}>REF: {friendlyId}</Typography>
                                             <Typography variant="body2" sx={{ color: 'var(--primary)', fontWeight: 900, fontSize: '0.85rem' }}>₹ {inv.invoice_amount}</Typography>
                                          </Box>
                                       </TableCell>
                                       <TableCell>
                                          <Chip 
                                            label={inv.status} 
                                            size="small" 
                                            sx={{ 
                                               fontWeight: 900, 
                                               fontSize: '0.55rem', 
                                               textTransform: 'uppercase', 
                                               bgcolor: inv.status === 'success' ? 'var(--success-glow)' : inv.status === 'failed' ? 'var(--error-glow)' : '#f1f5f9',
                                               color: inv.status === 'success' ? 'var(--success)' : inv.status === 'failed' ? 'var(--error)' : 'var(--text-muted)',
                                               height: 18,
                                               border: 'none'
                                            }} 
                                          />
                                          {inv.status === 'success' && <SuccessIcon sx={{ fontSize: 14, color: 'var(--success)', ml: 1, verticalAlign: 'middle' }} />}
                                       </TableCell>
                                       <TableCell align="right" sx={{ pr: 3 }}>
                                          {inv.status === 'failed' && (
                                            <Typography variant="caption" sx={{ color: 'var(--error)', fontWeight: 700, display: 'inline-block', mr: 2, maxWidth: 200, verticalAlign: 'middle', fontSize: '0.65rem' }}>
                                              {inv.error_message?.split(':')[0]}
                                            </Typography>
                                          )}
                                          <IconButton size="small" sx={{ color: 'var(--text-muted)', '&:hover': { color: 'var(--primary)', bgcolor: 'var(--primary-glow)' } }}><ChevronRight sx={{ fontSize: 16 }} /></IconButton>
                                       </TableCell>
                                    </TableRow>
                                   );
                                })}
                             </TableBody>
                          </Table>
                       </TableContainer>
                    </Box>
                </Box>
             </Fade>
           ) : (
             <Box sx={{ py: 20, textAlign: 'center', bgcolor: 'var(--bg-studio)', borderRadius: '40px', border: '1.5px dashed var(--surface-divider)' }}>
                {batches.length > 0 ? (
                  <>
                    <HistoryIcon sx={{ fontSize: 48, color: 'var(--text-muted)', mb: 2, opacity: 0.3 }} />
                    <Typography variant="h6" sx={{ fontWeight: 800, color: 'var(--text-muted)' }}>Select an Epoch for Intel</Typography>
                  </>
                ) : (
                  <Box sx={{ p: 4 }}>
                    <CircularProgress size={24} sx={{ mb: 2 }} />
                    <Typography variant="body2" sx={{ color: 'var(--text-muted)' }}>Syncing Operational Ledger...</Typography>
                  </Box>
                )}
             </Box>
           )}
        </Grid>
      </Grid>
    </Box>
  );
}
