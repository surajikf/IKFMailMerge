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
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Error as ErrorIcon,
  CheckCircle as SuccessIcon,
  History as HistoryIcon,
  ChevronRight,
  Timeline,
  Visibility,
  DeleteForever as DeleteForeverIcon,
} from '@mui/icons-material';

import { getAdminHeaders, extractApiError } from '../utils/api';

const API_BASE = '/api';
const PURGE_CONFIRM_PHRASE = 'DELETE_ALL_BATCH_DATA';

export default function Dashboard() {
  const { batch_id: urlBatchId } = useParams();
  const [batches, setBatches] = useState<any[]>([]); // Array of BatchSummary { batch, stats }
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(urlBatchId || null);
  const [batchInvoices, setBatchInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [purgePhrase, setPurgePhrase] = useState('');
  const [purging, setPurging] = useState(false);
  const [purgeError, setPurgeError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    // Senior QA: Stealth Refresh Protocol
    const isInitial = batches.length === 0;
    if (isInitial) setLoading(true);
    
    try {
      const res = await axios.get(`${API_BASE}/batches`, { headers: getAdminHeaders() });
      setBatches(res.data || []);
      if (!selectedBatchId && res.data.length > 0) {
        setSelectedBatchId(res.data[0].batch.batch_id);
      }
    } catch (err) {
      console.error("Ledger refresh failed:", err);
    } finally {
      if (isInitial) setLoading(false);
    }
  }, [selectedBatchId, batches.length]);

  useEffect(() => {
    document.title = "IKF MailMerge | Email Status";
    fetchData();
    const interval = setInterval(fetchData, 8000);
    return () => clearInterval(interval);
  }, [fetchData]);

  useEffect(() => {
    if (selectedBatchId) {
      axios.get(`${API_BASE}/status/${selectedBatchId}`, { headers: getAdminHeaders() }).then(res => {
        setBatchInvoices(res.data || []);
      }).catch(err => console.error("Invoice fetch failed:", err));
    }
  }, [selectedBatchId]);

  const handlePurgeAll = async () => {
    setPurgeError(null);
    if (purgePhrase.trim() !== PURGE_CONFIRM_PHRASE) {
      setPurgeError(`Type exactly: ${PURGE_CONFIRM_PHRASE}`);
      return;
    }
    setPurging(true);
    try {
      const headers = getAdminHeaders();
      const payload = { confirm: PURGE_CONFIRM_PHRASE };
      const attempts = [
        () => axios.post(`${API_BASE}/batches/purge_all`, payload, { headers }),
        () => axios.delete(`${API_BASE}/batches/purge_all`, { headers, data: payload }),
        () => axios.post(`${API_BASE}/purge_all_batches`, payload, { headers }),
        () => axios.post(`${API_BASE}/admin/purge_batch_data`, payload, { headers }),
      ];
      let cleared = false;
      for (const attempt of attempts) {
        try {
          await attempt();
          cleared = true;
          break;
        } catch (e: any) {
          const status = e?.response?.status;
          if (status !== 404 && status !== 405) {
            throw e;
          }
        }
      }
      if (!cleared) {
        throw new Error('Purge route not available on running backend.');
      }
      setPurgeOpen(false);
      setPurgePhrase('');
      const res = await axios.get(`${API_BASE}/batches`, { headers: getAdminHeaders() });
      setBatches(res.data || []);
      setSelectedBatchId(null);
      setBatchInvoices([]);
    } catch (err) {
      const { message, hint } = extractApiError(err, 'Could not clear data.');
      setPurgeError(hint ? `${message} ${hint}` : message);
    } finally {
      setPurging(false);
    }
  };

  // Memoize the active batch summary
  const activeBatchSummary = useMemo(() => batches.find(b => b.batch.batch_id === selectedBatchId), [batches, selectedBatchId]);
  const batchMeta = useMemo(() => {
    try {
      const raw = activeBatchSummary?.batch?.validation_summary;
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }, [activeBatchSummary]);
  const deliveryMeta = (batchMeta as any)?.delivery || {};
  const smtpMeta = deliveryMeta.smtp || null;
  const dispatchMeta = (batchMeta as any)?.dispatch_plan || null;

  const filteredBatches = useMemo(() => {
    if (!searchTerm) return batches;
    return batches.filter(b => 
      b.batch.batch_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      b.batch.status.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [batches, searchTerm]);

  if (loading && batches.length === 0) {
    return <Box display="flex" justifyContent="center" py={12}><CircularProgress thickness={5} size={48} /></Box>;
  }

  const columns = [
    { id: 'recipient_name', label: 'RECIPIENT' },
    { id: 'invoice_amount', label: 'AMOUNT' },
    { id: 'status', label: 'STATUS' },
    { id: 'diagnostics', label: 'DETAILS' },
  ];

  return (
    <Box sx={{ animation: 'studioFadeUp 0.8s' }}>
      <Grid container spacing={6} alignItems="flex-start">
        {/* Left: Operational Ledger */}
        <Grid item xs={12} md={4} lg={3} sx={{ alignSelf: 'flex-start' }}>
           <Box sx={{ position: { xs: 'static', md: 'sticky' }, top: { md: 96 } }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 4 }}>
                 <Timeline color="primary" sx={{ fontSize: 24 }} />
                 <Typography variant="h6" sx={{ fontWeight: 600 }}>Email Batches</Typography>
              </Box>
              
               <Paper variant="outlined" sx={{ borderRadius: '24px', overflow: 'hidden', border: '1.5px solid var(--surface-divider)', bgcolor: 'white', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                <Box sx={{ p: 2, bgcolor: '#fbfcfd', borderBottom: '1px solid var(--surface-divider)' }}>
                   <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                      <Typography variant="caption" sx={{ fontWeight: 900, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>RECENT BATCHES</Typography>
                      <RefreshIcon sx={{ fontSize: 14, color: 'var(--text-muted)', opacity: 0.5 }} />
                   </Box>
                   <TextField 
                      fullWidth 
                      size="small" 
                      placeholder="Search batches..." 
                      value={searchTerm}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchTerm(e.target.value)}
                      sx={{ '& .MuiInputBase-root': { borderRadius: '12px', bgcolor: 'white', fontSize: '0.75rem' } }}
                   />
                </Box>
                <Box sx={{ maxHeight: '50vh', overflowY: 'auto', '&::-webkit-scrollbar': { width: 4 }, '&::-webkit-scrollbar-thumb': { bgcolor: 'var(--surface-divider)', borderRadius: 10 } }}>
                   {filteredBatches.map(b => (
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
                               <Typography variant="caption" sx={{ fontWeight: 800, fontSize: '0.7rem', color: selectedBatchId === b.batch.batch_id ? 'var(--primary)' : 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%', letterSpacing: '-0.01em', fontFamily: 'var(--studio-font-main)' }}>
                                  {b.batch.batch_id.split('-')[0].toUpperCase()} ... {b.batch.batch_id.slice(-6).toUpperCase()}
                               </Typography>
                               <Chip 
                                  label={b.batch.status} 
                                  size="small" 
                                  sx={{ 
                                     height: 18, 
                                     fontSize: '0.6rem', 
                                     fontWeight: 900, 
                                     textTransform: 'uppercase', 
                                     bgcolor: b.batch.status === 'completed' ? 'var(--success-glow)' : 'var(--primary-glow)',
                                     color: b.batch.status === 'completed' ? 'var(--success)' : 'var(--primary)',
                                     border: 'none',
                                     letterSpacing: '0.02em'
                                  }} 
                               />
                            </Box>
                             <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                                <Typography variant="caption" sx={{ fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.65rem' }}>{b.stats?.total || 0} EMAILS</Typography>
                                <Typography variant="caption" sx={{ fontWeight: 700, color: 'var(--text-main)', fontSize: '0.65rem' }}>{new Date(b.batch.created_at || Date.now()).toLocaleDateString()}</Typography>
                             </Box>
                             {b.batch.status !== 'completed' && b.stats?.total > 0 && (
                                <Box sx={{ mt: 1.5 }}>
                                   <LinearProgress 
                                      variant="determinate" 
                                      value={((b.stats.success + b.stats.failed) / b.stats.total) * 100} 
                                      sx={{ height: 4, borderRadius: 2, bgcolor: 'rgba(0,0,0,0.04)', '& .MuiLinearProgress-bar': { borderRadius: 2 } }} 
                                   />
                                </Box>
                             )}
                          </Box>
                     ))}
                    {batches.length === 0 && (
                      <Box sx={{ p: 6, textAlign: 'center', opacity: 0.6 }}>
                         <HistoryIcon sx={{ fontSize: 32, mb: 1, color: 'var(--text-muted)' }} />
                         <Typography variant="body2" sx={{ fontWeight: 600, color: 'var(--text-muted)', display: 'block' }}>No batches yet</Typography>
                         <Typography variant="caption" sx={{ color: 'var(--text-muted)', display: 'block', mt: 0.5 }}>Upload a file to get started.</Typography>
                      </Box>
                    )}
                 </Box>
              </Paper>

              <Button
                fullWidth
                variant="outlined"
                color="error"
                startIcon={<DeleteForeverIcon />}
                onClick={() => {
                  setPurgeError(null);
                  setPurgePhrase('');
                  setPurgeOpen(true);
                }}
                sx={{ mt: 2, borderRadius: '14px', textTransform: 'none', fontWeight: 700 }}
              >
                Clear all batch data…
              </Button>
              
              <Box sx={{ mt: 4, p: 3, bgcolor: '#ffffff', borderRadius: '24px', border: '1.5px solid var(--primary)', boxShadow: 'var(--primary-glow) 0 4px 20px', position: 'relative', overflow: 'hidden' }}>
                  <Box sx={{ position: 'absolute', top: -10, right: -10, width: 60, height: 60, bgcolor: 'var(--primary-glow)', borderRadius: '50%', opacity: 0.5 }} />
                  <Typography variant="caption" sx={{ fontWeight: 900, color: 'var(--primary)', display: 'block', mb: 2, letterSpacing: '0.1em' }}>DELIVERY RATE</Typography>
                  <Box display="flex" alignItems="center" gap={2}>
                     <Typography variant="h3" sx={{ fontWeight: 900, color: 'var(--text-main)', letterSpacing: '-0.05em' }}>99.8%</Typography>
                     <Box sx={{ p: 1, bgcolor: 'var(--success-glow)', borderRadius: '12px' }}><SuccessIcon sx={{ color: 'var(--success)', fontSize: 24 }} /></Box>
                  </Box>
               </Box>
           </Box>
        </Grid>

        {/* Right: Deep Dive Intelligence */}
        <Grid item xs={12} md={8} lg={9}>
           {activeBatchSummary ? (
             <Fade in={true} timeout={500}>
                <Box>
                   <Box display="flex" justifyContent="space-between" alignItems="center" mb={6}>
                      <Box>
                         <Box display="flex" alignItems="center" gap={1.5} mb={0.5}>
                            <Typography variant="h4" sx={{ fontWeight: 900, letterSpacing: '-0.04em' }}>Batch Details</Typography>
                            {activeBatchSummary.batch.status !== 'completed' && <Box className="pulse-dot" sx={{ bgcolor: 'var(--primary)', mb: 1 }} />}
                         </Box>
                         <Typography variant="body2" sx={{ color: 'var(--text-muted)', fontWeight: 600 }}>Showing details for batch <span style={{ color: 'var(--primary)', fontWeight: 800 }}>#{activeBatchSummary.batch.batch_id.slice(-8).toUpperCase()}</span></Typography>
                      </Box>
                       <Box display="flex" gap={2}>
                          <Button variant="contained" className="btn-studio" startIcon={<RefreshIcon />} onClick={fetchData} sx={{ px: 4, borderRadius: '14px' }}>Refresh</Button>
                       </Box>
                   </Box>

                    <Grid container spacing={2} mb={4}>
                      {[
                        { label: 'SENT', val: activeBatchSummary.stats?.success || 0, color: 'var(--success)', icon: <SuccessIcon />, class: 'success' },
                        { label: 'FAILED', val: activeBatchSummary.stats?.failed || 0, color: 'var(--error)', icon: <ErrorIcon />, class: 'error' },
                        { label: 'PENDING', val: activeBatchSummary.stats?.pending || 0, color: 'var(--text-muted)', icon: <HistoryIcon />, class: 'pending' },
                      ].map(s => (
                        <Grid item xs={12} sm={4} key={s.label}>
                           <Paper className={`status-tile ${s.class}`} sx={{ p: 3, borderRadius: '24px', bgcolor: 'white', position: 'relative', overflow: 'hidden', border: '1.5px solid var(--surface-divider)' }}>
                              <Box display="flex" justifyContent="space-between" mb={1}>
                                 <Typography variant="caption" sx={{ fontWeight: 900, color: 'var(--text-muted)', letterSpacing: '0.12em', fontSize: '0.6rem' }}>{s.label}</Typography>
                                 <Box sx={{ color: s.color, opacity: 0.7 }}>{s.icon}</Box>
                              </Box>
                              <Typography variant="h4" sx={{ fontWeight: 900, color: 'var(--text-main)', letterSpacing: '-0.03em', fontFamily: 'var(--studio-font-main)' }}>{s.val}</Typography>
                           </Paper>
                        </Grid>
                      ))}
                   </Grid>

                   <Box sx={{ mb: 6, p: 3, bgcolor: '#ffffff', borderRadius: '24px', border: '1.5px solid var(--surface-divider)', boxShadow: '0 2px 8px rgba(0,0,0,0.01)' }}>
                      <Box display="flex" justifyContent="space-between" mb={2}>
                         <Box display="flex" alignItems="center" gap={1}>
                            <Typography variant="caption" sx={{ fontWeight: 800, color: 'var(--text-main)', letterSpacing: '0.05em' }}>PROGRESS</Typography>
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
                                  EST. TIME LEFT: ~{Math.ceil(activeBatchSummary.stats.pending * 0.1)} MIN
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

                  <Paper variant="outlined" sx={{ mb: 4, p: 3, borderRadius: '20px', border: '1.5px solid var(--surface-divider)' }}>
                    <Typography variant="caption" sx={{ fontWeight: 800, color: 'var(--text-main)', letterSpacing: '0.05em' }}>
                      DELIVERY DETAILS
                    </Typography>
                    <Grid container spacing={2} sx={{ mt: 0.5 }}>
                      <Grid item xs={12} sm={6} md={4}>
                        <Typography variant="caption" sx={{ color: 'var(--text-muted)', fontWeight: 700 }}>Provider</Typography>
                        <Typography variant="body2" sx={{ fontWeight: 800 }}>{deliveryMeta.provider || activeBatchSummary.batch.provider || 'Unknown'}</Typography>
                      </Grid>
                      <Grid item xs={12} sm={6} md={4}>
                        <Typography variant="caption" sx={{ color: 'var(--text-muted)', fontWeight: 700 }}>SMTP Account</Typography>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>{smtpMeta?.display_name || 'N/A'}</Typography>
                      </Grid>
                      <Grid item xs={12} sm={6} md={4}>
                        <Typography variant="caption" sx={{ color: 'var(--text-muted)', fontWeight: 700 }}>SMTP User</Typography>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>{smtpMeta?.user || 'N/A'}</Typography>
                      </Grid>
                      <Grid item xs={12} sm={6} md={4}>
                        <Typography variant="caption" sx={{ color: 'var(--text-muted)', fontWeight: 700 }}>SMTP Host</Typography>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>
                          {smtpMeta ? `${smtpMeta.host}:${smtpMeta.port}` : 'N/A'}
                        </Typography>
                      </Grid>
                      <Grid item xs={12} sm={6} md={4}>
                        <Typography variant="caption" sx={{ color: 'var(--text-muted)', fontWeight: 700 }}>Scheduled For</Typography>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>
                          {activeBatchSummary.batch.scheduled_for ? new Date(activeBatchSummary.batch.scheduled_for).toLocaleString() : 'Immediate'}
                        </Typography>
                      </Grid>
                      <Grid item xs={12} sm={6} md={4}>
                        <Typography variant="caption" sx={{ color: 'var(--text-muted)', fontWeight: 700 }}>Timeline</Typography>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>
                          {activeBatchSummary.batch.started_at ? new Date(activeBatchSummary.batch.started_at).toLocaleString() : 'Not started'}
                          {' -> '}
                          {activeBatchSummary.batch.completed_at ? new Date(activeBatchSummary.batch.completed_at).toLocaleString() : 'In progress'}
                        </Typography>
                      </Grid>
                      {dispatchMeta?.enabled && (
                        <Grid item xs={12}>
                          <Typography variant="caption" sx={{ color: 'var(--text-muted)', fontWeight: 700 }}>Campaign Pacing</Typography>
                          <Typography variant="body2" sx={{ fontWeight: 700 }}>
                            Slots: {dispatchMeta.slots?.length || 0} | Slot minutes: {dispatchMeta.slot_minutes || '-'} | Planned: {dispatchMeta.total_planned || '-'}
                          </Typography>
                        </Grid>
                      )}
                    </Grid>
                  </Paper>

                    <Box sx={{ p: 0.5 }}>
                       <Typography variant="caption" sx={{ fontWeight: 800, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
                          <Visibility sx={{ fontSize: 16 }} /> EMAIL LOGS
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
                    <Typography variant="h6" sx={{ fontWeight: 800, color: 'var(--text-muted)' }}>Select a batch</Typography>
                  </>
                ) : (
                  <Box sx={{ p: 4 }}>
                    <CircularProgress size={24} sx={{ mb: 2 }} />
                    <Typography variant="body2" sx={{ color: 'var(--text-muted)' }}>Loading batches...</Typography>
                  </Box>
                )}
             </Box>
           )}
        </Grid>
      </Grid>

      <Dialog open={purgeOpen} onClose={() => !purging && setPurgeOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>Clear all batch &amp; email log data?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2, color: 'var(--text-muted)' }}>
            This permanently deletes every batch and every recipient row from the database (what you see on Status). Settings, SMTP accounts, and templates are not removed.
          </Typography>
          {purgeError && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setPurgeError(null)}>
              {purgeError}
            </Alert>
          )}
          <Typography variant="caption" sx={{ display: 'block', mb: 1, fontWeight: 700 }}>
            Type <strong>{PURGE_CONFIRM_PHRASE}</strong> to confirm:
          </Typography>
          <TextField
            fullWidth
            size="small"
            value={purgePhrase}
            onChange={(e) => setPurgePhrase(e.target.value)}
            placeholder={PURGE_CONFIRM_PHRASE}
            disabled={purging}
            autoFocus
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setPurgeOpen(false)} disabled={purging}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            disabled={purging || purgePhrase.trim() !== PURGE_CONFIRM_PHRASE}
            onClick={handlePurgeAll}
          >
            {purging ? 'Clearing…' : 'Clear database'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
