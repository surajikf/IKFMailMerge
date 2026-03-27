import { useState, useCallback, useEffect, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import Swal from 'sweetalert2';
import {
  Typography,
  Box,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Chip,
  Paper,
  Grid,
  Fade,
  IconButton,
} from '@mui/material';
import {
  CloudUpload,
  CheckCircle,
  Visibility,
  ArrowBack,
  ArrowForward,
  ContentPaste as MappingIcon,
  Laptop,
  Smartphone,
} from '@mui/icons-material';
import RichTextEditor from '../components/RichTextEditor';
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

const steps = [
  { id: 'Discovery', label: '1. Source Discovery' },
  { id: 'Mapping', label: '2. Variable Mapping' },
  { id: 'Design', label: '3. Outreach Architect' },
  { id: 'Launch', label: '4. Dispatch Engine' }
];

export default function FileUpload() {
  const [activeStep, setActiveStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [sampleData, setSampleData] = useState<any[]>([]);
  const [mapping, setMapping] = useState({ name: '', email: '', amount: '', date: '' });
  const [template, setTemplate] = useState({ subject: '', html: '', is_html: true });
  const [loading, setLoading] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [testEmail, setTestEmail] = useState('');
  const [testLoading, setTestLoading] = useState(false);
  const [scheduledFor, setScheduledFor] = useState('');
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop');

  const navigate = useNavigate();
  const subjectRef = useRef<HTMLInputElement>(null);
  const [lastFocused, setLastFocused] = useState<'subject' | 'message'>('message');

  // Load initial settings for the composer
  useEffect(() => {
    document.title = "IKF MailMerge | Outreach Architect";
    axios.get(`${API_BASE}/settings`).then(res => {
      setTemplate({
        subject: res.data.email_template_subject || '',
        html: res.data.email_template_html || '',
        is_html: res.data.email_template_is_html,
      });
    }).catch(() => {});
  }, []);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const selected = acceptedFiles[0];
    if (!selected) return;

    setLoading(true);
    const formData = new FormData();
    formData.append('file', selected);
    try {
      const res = await axios.post(`${API_BASE}/upload`, formData);
      setFile(selected);
      setColumns(res.data.columns);
      setSampleData(res.data.sample_data);
      
      const rec = res.data.recommended_mapping || {};
      const findCol = (keys: string[]) => 
        res.data.columns.find((c: string) => {
          const cl = c.toLowerCase();
          // Avoid matching ID columns for Name/Email if possible
          if (keys.includes('name') && cl.includes('id')) return false;
          return keys.some(k => cl.includes(k));
        }) || '';
      
      setMapping({
        name: rec.name || findCol(['name', 'client', 'recipient']),
        email: rec.email || findCol(['email', 'mail', 'to']),
        amount: rec.amount || findCol(['amount', 'total', 'due', 'value']),
        date: rec.date || findCol(['date', 'deadline', 'created']),
      });
      Toast.fire({ icon: 'success', title: 'Data Discovered.' });
      setActiveStep(1); // Auto-advance to mapping
    } catch (err: any) {
      Swal.fire({ icon: 'error', title: 'Discovery Failed', text: extractApiError(err).message });
    } finally {
      setLoading(false);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, maxFiles: 1, accept: { 'text/csv': ['.csv'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } });

  const handleProcessMapping = async () => {
    if (!file || !mapping.email) return;
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mapping', JSON.stringify(mapping));
      const res = await axios.post(`${API_BASE}/process_upload`, formData);
      setBatchId(res.data.batch_id);
      setActiveStep(2); // Go to Architect/Composer
    } catch (err) {
      const apiErr = extractApiError(err);
      Swal.fire({ icon: 'error', title: 'Mapping Failed', text: apiErr.message || 'Could not reconcile variables.' });
    } finally {
      setLoading(false);
    }
  };

  const handleLaunch = async () => {
    if (!batchId) return;
    setLoading(true);
    try {
      await axios.post(`${API_BASE}/send_emails`, {
        batch_id: batchId,
        custom_subject: template.subject,
        custom_html: template.html,
        is_html: template.is_html,
        scheduled_for: scheduledFor ? new Date(scheduledFor).toISOString() : null,
      });
      Swal.fire({ icon: 'success', title: 'Cycle Initiated', text: 'The outreach process is now active.' });
      navigate(`/status/${batchId}`);
    } catch (err: any) {
      Swal.fire({ icon: 'error', title: 'Dispatch Error', text: extractApiError(err).message });
    } finally {
      setLoading(false);
    }
  };

  const insertVar = (v: string) => {
    const tag = `{{${v}}}`;
    if (lastFocused === 'subject' && subjectRef.current) {
        const start = subjectRef.current.selectionStart || 0;
        const end = subjectRef.current.selectionEnd || 0;
        const text = template.subject;
        setTemplate({ ...template, subject: text.substring(0, start) + tag + text.substring(end) });
    } else {
        // For RichTextEditor, we insert raw text that the editor handles
        const editor = document.querySelector('.ql-editor');
        if (editor && lastFocused === 'message') {
           document.execCommand('insertText', false, tag);
        } else {
           // Fallback for HTML mode
           setTemplate(prev => ({ ...prev, html: prev.html + tag }));
        }
    }
  };

  const [sampleIdx, setSampleIdx] = useState(0);

  const processPreview = (text: string) => {
    if (!sampleData.length || !text) return text;
    let processed = text;
    const row = sampleData[sampleIdx % sampleData.length];
    
    // Replace raw column tags ({{ColName}}) based on the actual columns in the file
    columns.forEach(col => {
      const escapedCol = col.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`{{${escapedCol}}}`, 'g');
      processed = processed.replace(regex, `<span style="background: rgba(22, 102, 211, 0.08); color: var(--primary); padding: 0 4px; border-radius: 4px; font-weight: 500;">${String(row[col] || '')}</span>`);
    });

    return processed;
  };

  const renderContentPrev = () => {
    return processPreview(template.html);
  };

  return (
    <Box sx={{ maxWidth: '100%', mx: 'auto', p: { xs: 2, md: 4 } }}>
      {/* Minimal Process Pill */}
      <Box sx={{ display: 'flex', justifyContent: 'center', mb: 8 }}>
         <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, px: 3, bgcolor: 'var(--bg-studio)', borderRadius: '999px', border: '1px solid var(--surface-divider)', boxShadow: 'var(--shadow-inner)' }}>
            {steps.map((s, idx) => (
               <Box key={s.id} sx={{ display: 'flex', alignItems: 'center' }}>
                  <Typography variant="caption" sx={{ fontWeight: activeStep === idx ? 600 : 400, color: activeStep === idx ? 'var(--primary)' : 'var(--text-muted)', fontSize: '0.7rem', letterSpacing: '0.02em', transition: 'all 0.3s ease' }}>
                     {s.label.replace(/^\d+\.\s/, '').toUpperCase()}
                  </Typography>
                  {idx < steps.length - 1 && (
                     <Box sx={{ width: 4, height: 4, borderRadius: '50%', bgcolor: 'var(--surface-divider)', mx: 2 }} />
                  )}
               </Box>
            ))}
         </Box>
      </Box>

      {/* Stage 1: Discovery */}
      {activeStep === 0 && (
        <Fade in timeout={800}>
          <Box className="hero-canvas" sx={{ py: 4 }}>
             <Box className="hero-eyebrow" sx={{ mb: 4 }}>DATA DISCOVERY</Box>
             <Typography className="hero-title" variant="h1" sx={{ mb: 2 }}>Securely import <br/><span style={{ color: 'var(--primary)' }}>your network data.</span></Typography>
             <Typography variant="body1" sx={{ color: 'var(--text-muted)', mb: 8 }}>Accepting precision CSV and XLSX datasets for global orchestration.</Typography>
             
             <Box {...getRootProps()} className={`dropzone ${isDragActive ? 'active' : ''}`} sx={{ py: 12, maxWidth: 800, mx: 'auto', borderStyle: isDragActive ? 'solid' : 'dashed' }}>
                <input {...getInputProps()} />
                <Box className="dropzone-icon" sx={{ position: 'relative', display: 'inline-block', mb: 3 }}>
                   <CloudUpload sx={{ fontSize: 64, color: file ? 'var(--success)' : 'var(--primary)', transition: 'all 0.3s ease' }} />
                   {file && <CheckCircle sx={{ position: 'absolute', bottom: -5, right: -5, fontSize: 24, color: 'var(--success)', bgcolor: 'white', borderRadius: '50%' }} />}
                </Box>
                <Typography variant="h5" sx={{ fontWeight: 600, mb: 1 }}>{file ? file.name : "Initiate Global Import"}</Typography>
                <Typography variant="body2" sx={{ fontWeight: 500, color: 'var(--text-muted)', maxWidth: 400, mx: 'auto' }}>
                   {isDragActive ? "Release to finalize discovery..." : "Drag and drop your outreach dataset here, or click to browse local storage."}
                </Typography>
                {file && (
                  <Typography variant="caption" sx={{ mt: 2, display: 'block', color: 'var(--success)', fontWeight: 600, letterSpacing: '0.05em' }}>
                    READY FOR ARCHITECTURE RECONCILIATION
                  </Typography>
                )}
             </Box>
          </Box>
        </Fade>
      )}

      {/* Stage 2: Mapping */}
      {activeStep === 1 && (
        <Fade in timeout={800}>
          <Box sx={{ animation: 'studioFadeUp 0.8s' }}>
             <Box className="hero-eyebrow" sx={{ mb: 2 }}>ARCHITECTURE & RECONCILIATION</Box>
             <Typography variant="h4" sx={{ fontWeight: 600, mb: 6 }}>Reconcile your <span style={{ color: 'var(--primary)' }}>variables.</span></Typography>
             
             <Grid container spacing={4}>
                <Grid item xs={12} md={7}>
                   <Paper className="studio-card" sx={{ p: 5 }}>
                      <Box display="flex" alignItems="center" gap={1.5} mb={4}>
                         <MappingIcon color="primary" sx={{ fontSize: 20 }} />
                         <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Precision Matching</Typography>
                      </Box>
                      <Grid container spacing={3}>
                        {['name', 'email', 'amount', 'date'].map((f) => (
                          <Grid item xs={12} sm={6} key={f}>
                            <FormControl fullWidth size="small">
                              <InputLabel sx={{ fontWeight: 500 }}>{f.toUpperCase()}</InputLabel>
                              <Select value={mapping[f as keyof typeof mapping]} label={f.toUpperCase()} onChange={(e) => setMapping({ ...mapping, [f]: e.target.value })}>
                                <MenuItem value=""><em>-- AUTOMATIC --</em></MenuItem>
                                {columns.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                              </Select>
                            </FormControl>
                          </Grid>
                        ))}
                      </Grid>
                      
                      <Box mt={6}>
                         <Button fullWidth variant="contained" className="btn-studio" onClick={handleProcessMapping} disabled={loading || !mapping.email}>
                            Confirm & Access Architect
                         </Button>
                      </Box>
                   </Paper>
                </Grid>

                <Grid item xs={12} md={5}>
                   <Box sx={{ p: 4, borderRadius: '24px', bgcolor: 'var(--primary-glow)', border: '1px solid var(--primary-glow)' }}>
                      <Typography variant="caption" sx={{ fontWeight: 600, color: 'var(--primary)', letterSpacing: '0.1em' }}>INTELLIGENCE FEED</Typography>
                      <Box sx={{ mt: 3, display: 'grid', gap: 2 }}>
                         {Object.keys(mapping).map(k => (
                            <Box key={k} sx={{ p: 2, bgcolor: 'white', borderRadius: '16px', display: 'flex', justifyContent: 'space-between' }}>
                               <Typography variant="caption" sx={{ fontWeight: 500, color: 'var(--text-muted)' }}>{k.toUpperCase()}</Typography>
                               <Typography variant="body2" sx={{ fontWeight: 600 }}>{sampleData[0][mapping[k as keyof typeof mapping]] || '---'}</Typography>
                            </Box>
                         ))}
                      </Box>
                   </Box>
                </Grid>
             </Grid>
          </Box>
        </Fade>
      )}

      {/* Stage 3: Architect (Composer) */}
      {activeStep === 2 && (
        <Fade in timeout={800}>
          <Box sx={{ animation: 'studioFadeUp 0.8s' }}>
             <Box display="flex" justifyContent="space-between" alignItems="flex-end" mb={6}>
                <Box>
                   <Box className="hero-eyebrow" sx={{ mb: 1 }}>OUTREACH ARCHITECT</Box>
                   <Typography variant="h4" sx={{ fontWeight: 600 }}>Design your <span style={{ color: 'var(--primary)' }}>messaging.</span></Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 2, p: 0.75, bgcolor: 'var(--bg-studio)', borderRadius: '20px', border: '1px solid var(--surface-border)' }}>
                   <Button size="small" onClick={() => setTemplate({ ...template, is_html: false })} sx={{ borderRadius: '14px', bgcolor: !template.is_html ? 'white' : 'transparent', color: !template.is_html ? 'var(--primary)' : 'var(--text-muted)', fontWeight: 500, px: 3, boxShadow: !template.is_html ? 'var(--shadow-sm)' : 'none' }}>Visual Edit</Button>
                   <Button size="small" onClick={() => setTemplate({ ...template, is_html: true })} sx={{ borderRadius: '14px', bgcolor: template.is_html ? 'white' : 'transparent', color: template.is_html ? 'var(--primary)' : 'var(--text-muted)', fontWeight: 500, px: 3, boxShadow: template.is_html ? 'var(--shadow-sm)' : 'none' }}>HTML Source</Button>
                </Box>
             </Box>

              <Grid container spacing={4}>
                <Grid item xs={12} lg={6}>
                   <Paper className="studio-card" sx={{ p: 5, mb: 4, height: 'auto', minHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
                      <TextField fullWidth label="High-Precision Subject" variant="standard" InputProps={{ sx: { fontSize: '1.25rem', fontWeight: 600, pb: 1 } }} value={template.subject} inputRef={subjectRef} onFocus={() => setLastFocused('subject')} onChange={(e) => setTemplate({ ...template, subject: e.target.value })} sx={{ mb: 4 }} />
                      
                      <Box sx={{ mb: 4, display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                        {columns.map(v => (
                          <Chip key={v} label={`{{${v}}}`} size="small" onClick={() => insertVar(v)} sx={{ height: 32, borderRadius: '8px', fontWeight: 500, bgcolor: 'var(--bg-studio)', border: '1.5px solid var(--surface-border)', cursor: 'pointer', '&:hover': { bgcolor: 'var(--primary-glow)', borderColor: 'var(--primary)', color: 'var(--primary)' } }} />
                        ))}
                      </Box>
                      
                      <Box sx={{ flex: 1, minHeight: 400 }}>
                        {template.is_html ? (
                          <TextField fullWidth multiline rows={32} placeholder="Start architecting with HTML..." value={template.html} onChange={(e) => setTemplate({ ...template, html: e.target.value })} sx={{ height: '100%', '& .MuiInputBase-root': { fontFamily: "'JetBrains Mono', monospace", fontSize: '0.85rem', bgcolor: '#fbfcfd', borderRadius: '16px', height: '100%', alignItems: 'flex-start' } }} />
                        ) : (
                          <RichTextEditor value={template.html} onChange={v => setTemplate({ ...template, html: v })} placeholder="Start architecting your outreach..." />
                        )}
                      </Box>
                      
                      <Box mt={6}>
                         <Button 
                           fullWidth 
                           variant="contained" 
                           className="btn-studio" 
                           onClick={async () => {
                             setLoading(true);
                             try {
                               await axios.post(`${API_BASE}/settings`, {
                                 email_template_subject: template.subject,
                                 email_template_html: template.html,
                                 email_template_is_html: template.is_html
                               });
                               setActiveStep(3);
                             } catch(err) {
                               console.error("Auto-save failed:", err);
                               setActiveStep(3); 
                             } finally {
                               setLoading(false);
                             }
                           }} 
                           disabled={!template.subject || !template.html || loading} 
                           sx={{ py: 2.5, fontSize: '1.05rem' }}
                         >
                            {loading ? 'Persisting Design...' : 'Proceed to Final Validation'}
                         </Button>
                      </Box>
                   </Paper>

                   <Box className="studio-card" sx={{ p: 3, display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Box flex={1}>
                         <TextField fullWidth size="small" placeholder="Test recipient email..." value={testEmail} onChange={e => setTestEmail(e.target.value)} sx={{ '& .MuiInputBase-root': { borderRadius: '12px' } }} />
                      </Box>
                      <Button variant="contained" className="btn-studio" sx={{ px: 4 }} onClick={async () => {
                         setTestLoading(true);
                         try { await axios.post(`${API_BASE}/send_test_email`, { ...template, batch_id: batchId, test_email: testEmail }); Toast.fire({ icon: 'success', title: 'Test Dispatched.' }); }
                         catch(err) { const apiErr = extractApiError(err); Toast.fire({ icon: 'error', title: 'Failed.', text: apiErr.message }); }
                         finally { setTestLoading(false); }
                      }} disabled={testLoading || !testEmail}>{testLoading ? '...' : 'Verify'}</Button>
                   </Box>
                </Grid>

                <Grid item xs={12} lg={6}>
                   <Box sx={{ position: 'sticky', top: 120 }}>
                      <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
                        <Box display="flex" alignItems="center" gap={1.5}>
                           <Typography variant="caption" sx={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1, letterSpacing: '0.05em' }}>
                              <Visibility color="primary" sx={{ fontSize: 16 }} /> REAL-TIME VISUAL INTEL
                           </Typography>
                           {sampleData.length > 1 && (
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, bgcolor: 'var(--primary-glow)', px: 1, py: 0.2, borderRadius: '999px', border: '1px solid var(--primary)' }}>
                                 <IconButton size="small" onClick={() => setSampleIdx(prev => Math.max(0, prev - 1))} disabled={sampleIdx === 0} sx={{ p: 0, color: 'var(--primary)' }}><ArrowBack sx={{ fontSize: 12 }} /></IconButton>
                                 <Typography variant="caption" sx={{ fontWeight: 700, fontSize: '0.6rem', color: 'var(--primary)', px: 0.5 }}>{sampleIdx + 1}/{sampleData.length}</Typography>
                                 <IconButton size="small" onClick={() => setSampleIdx(prev => Math.min(sampleData.length - 1, prev + 1))} disabled={sampleIdx === sampleData.length - 1} sx={{ p: 0, color: 'var(--primary)' }}><ArrowForward sx={{ fontSize: 12 }} /></IconButton>
                              </Box>
                           )}
                           <Box sx={{ display: 'flex', gap: 0.5, bgcolor: 'var(--bg-studio)', p: 0.5, borderRadius: '8px', border: '1px solid var(--surface-border)' }}>
                              <IconButton size="small" onClick={() => setViewport('desktop')} sx={{ p: 0.5, color: viewport === 'desktop' ? 'var(--primary)' : 'var(--text-muted)', bgcolor: viewport === 'desktop' ? 'white' : 'transparent', borderRadius: '6px' }}><Laptop sx={{ fontSize: 16 }} /></IconButton>
                              <IconButton size="small" onClick={() => setViewport('mobile')} sx={{ p: 0.5, color: viewport === 'mobile' ? 'var(--primary)' : 'var(--text-muted)', bgcolor: viewport === 'mobile' ? 'white' : 'transparent', borderRadius: '6px' }}><Smartphone sx={{ fontSize: 16 }} /></IconButton>
                           </Box>
                        </Box>
                        <Chip label={`Visualizing: ${sampleData[sampleIdx]?.[mapping.name] || 'Draft Mode'}`} size="small" sx={{ fontWeight: 600, fontSize: '0.65rem', bgcolor: 'var(--primary-glow)', color: 'var(--primary)', border: '1px solid var(--primary)' }} />
                      </Box>

                      <Paper variant="outlined" sx={{ borderRadius: '32px', overflow: 'hidden', border: '1.5px solid var(--surface-border)', height: '88vh', bgcolor: 'white', boxShadow: '0 20px 80px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', transition: 'width 0.3s ease', maxWidth: viewport === 'mobile' ? 375 : '100%', mx: 'auto' }}>
                         <Box sx={{ p: 3.5, bgcolor: '#fbfcfd', borderBottom: '1px solid var(--surface-divider)' }}>
                            <Typography variant="body2" sx={{ fontWeight: 600, color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{processPreview(template.subject) || "Drafting subject..."}</Typography>
                         </Box>
                         <Box sx={{ flex: 1, overflow: 'hidden', bgcolor: '#fff', position: 'relative' }}>
                             <iframe title="preview" srcDoc={renderContentPrev()} style={{ width: '100%', height: '100%', border: 'none', position: 'absolute', top: 0, left: 0 }} />
                         </Box>
                      </Paper>
                   </Box>
                </Grid>
             </Grid>
          </Box>
        </Fade>
      )}

      {/* Stage 4: Launch */}
      {activeStep === 3 && (
        <Fade in timeout={1000}>
          <Box sx={{ textAlign: 'center', py: 6 }}>
             <Paper className="studio-card" sx={{ p: 10, maxWidth: 700, mx: 'auto' }}>
                <CheckCircle sx={{ fontSize: 96, color: 'var(--success)', mb: 4, filter: 'drop-shadow(0 10px 20px var(--success-glow))' }} />
                <Typography variant="h3" sx={{ fontWeight: 600, mb: 2 }}>Mission Optimized.</Typography>
                <Typography variant="body1" sx={{ color: 'var(--text-muted)', fontWeight: 500, mb: 6 }}>Your campaign has been architected and verified. Dispatch is ready.</Typography>

                <Grid container spacing={4} sx={{ mb: 8 }}>
                   {[
                      { label: 'DELIVERIES', value: sampleData.length },
                      { label: 'RELIABILITY', value: '100%' },
                      { label: 'SECURITY', value: 'ENCRYPTED' },
                   ].map(s => (
                      <Grid item xs={4} key={s.label}>
                         <Typography variant="caption" sx={{ fontWeight: 600, color: 'var(--text-muted)', display: 'block', mb: 1 }}>{s.label}</Typography>
                         <Typography variant="h5" sx={{ fontWeight: 600 }}>{s.value}</Typography>
                      </Grid>
                   ))}
                </Grid>

                <Box sx={{ maxWidth: 450, mx: 'auto' }}>
                   <TextField fullWidth type="datetime-local" label="Scheduled Deployment" InputLabelProps={{ shrink: true }} value={scheduledFor} onChange={e => setScheduledFor(e.target.value)} sx={{ mb: 5 }} />
                   <Button fullWidth variant="contained" className="btn-studio" size="large" onClick={handleLaunch} sx={{ py: 2.8, fontSize: '1.25rem' }}>
                      Execute Global Dispatch
                   </Button>
                   <Button sx={{ mt: 3, fontWeight: 600, color: 'var(--text-muted)' }} onClick={() => setActiveStep(2)}>Adjust Design Protocols</Button>
                </Box>
             </Paper>
          </Box>
        </Fade>
      )}

      {/* Persistence Floor Controls */}
      <Box sx={{ mt: 12, pt: 6, display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--surface-divider)' }}>
         <Box>
           {activeStep > 0 && (
             <Button startIcon={<ArrowBack />} onClick={() => setActiveStep(activeStep - 1)} sx={{ fontWeight: 600, color: 'var(--text-muted)' }}>
                Previous Epoch
             </Button>
           )}
         </Box>
         <Typography variant="caption" sx={{ alignSelf: 'center', fontWeight: 500, color: 'var(--text-muted)', opacity: 0.5 }}>
            STEP {activeStep + 1} OF 4 · PRECISION OUTREACH
         </Typography>
      </Box>
    </Box>
  );
}
