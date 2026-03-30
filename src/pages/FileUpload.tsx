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
import RichTextEditor, { RichTextEditorHandle } from '../components/RichTextEditor';
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

const THEME_SHELLS: Record<string, string> = {
  "Modern Slate": `<div style="font-family: 'Inter', sans-serif; color: #1e293b; line-height: 1.6; padding: 40px; background: #fcfdfe; transition: all 0.3s ease;">
      <div style="max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 20px; overflow: hidden; background: #ffffff; box-shadow: 0 4px 12px rgba(0,0,0,0.03);">
        <div style="padding: 40px;">{{CONTENT}}</div>
      </div>
    </div>`,
  "Executive Indigo": `<div style="font-family: 'Outfit', sans-serif; background: #f8fafc; padding: 60px 20px;">
      <div style="max-width: 600px; margin: 0 auto; border-top: 8px solid #1666d3; background: #ffffff; border-radius: 16px; box-shadow: 0 20px 40px rgba(0,0,0,0.05); overflow: hidden;">
        <div style="padding: 40px;">{{CONTENT}}</div>
        <div style="background: #1666d3; padding: 12px; text-align: center; color: rgba(255,255,255,0.7); font-size: 11px; font-weight: 700; letter-spacing: 0.1em;">POWERED BY IKF MAILMERGE</div>
      </div>
    </div>`,
  "Clean Minimalist": `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #334155; padding: 40px; line-height: 1.5;">
      <div style="max-width: 550px; margin: 0 auto;">{{CONTENT}}</div>
    </div>`,
  "Business Glass": `<div style="font-family: 'Inter', sans-serif; background: #f1f5f9; padding: 40px;">
      <div style="max-width: 600px; margin: 0 auto; background: rgba(255,255,255,0.9); backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.5); border-radius: 32px; padding: 40px; box-shadow: 0 10px 30px rgba(0,0,0,0.05);">
        {{CONTENT}}
      </div>
    </div>`,
  "Success Green": `<div style="font-family: sans-serif; background: #ffffff; padding: 40px; border: 1px solid #dcfce7; border-image: linear-gradient(to right, #10b981, #ffffff) 1;">
      <div style="max-width: 600px; margin: 0 auto; border-left: 4px solid #10b981; padding-left: 30px;">
        {{CONTENT}}
      </div>
    </div>`
};


export default function FileUpload() {
  const [activeStep, setActiveStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [sampleData, setSampleData] = useState<any[]>([]);
  const [mapping, setMapping] = useState({ name: '', email: '', amount: '', date: '' });
  const [template, setTemplate] = useState({ subject: '', html: '', is_html: true });
  const [hasPrevious, setHasPrevious] = useState(false);
  const [prevTemplate, setPrevTemplate] = useState({ subject: '', html: '', is_html: true });
  const [loading, setLoading] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [testEmail, setTestEmail] = useState('');
  const [testLoading, setTestLoading] = useState(false);
  const [scheduledFor, setScheduledFor] = useState('');
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop');
  const [loadingMessage, setLoadingMessage] = useState('Initiating...');
  const [rawUserBody, setRawUserBody] = useState('<p>Hi {{Client Name}}, here is your invoice for {{Pending Amount}}.</p>');
  const [activeTheme, setActiveTheme] = useState('none');

  const navigate = useNavigate();
  const subjectRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<RichTextEditorHandle>(null);
  const [lastFocused, setLastFocused] = useState<'subject' | 'message'>('message');

  // Load initial settings for the composer
  useEffect(() => {
    document.title = "IKF MailMerge | Outreach Architect";
    axios.get(`${API_BASE}/settings`).then(res => {
      if (res.data.email_template_subject || res.data.email_template_html) {
        setHasPrevious(true);
        setPrevTemplate({
          subject: res.data.email_template_subject || '',
          html: res.data.email_template_html || '',
          is_html: res.data.email_template_is_html,
        });
      }
    }).catch(() => {});
  }, []);

  const loadingMessages = [
    "Accessing dataset...",
    "Discovering patterns...",
    "Decrypting architecture...",
    "Reconciling variables...",
    "Syncing outreach engine..."
  ];

  useEffect(() => {
    let interval: any;
    if (loading) {
      let idx = 0;
      setLoadingMessage(loadingMessages[0]);
      interval = setInterval(() => {
        idx = (idx + 1) % loadingMessages.length;
        setLoadingMessage(loadingMessages[idx]);
      }, 1500);
    }
    return () => clearInterval(interval);
  }, [loading]);

  // --- Session Persistence Engine ---
  const SESSION_KEY = 'ikf_mailmerge_session';

  // Save session on state change
  useEffect(() => {
    if (activeStep > 0 || template.subject || template.html) {
      const sessionData = {
        activeStep,
        mapping,
        template,
        batchId,
        columns,
        sampleData,
      };
      localStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
    }
  }, [activeStep, mapping, template, batchId, columns, sampleData]);

  // Load session on mount
  useEffect(() => {
    const saved = localStorage.getItem(SESSION_KEY);
    if (saved) {
      try {
        const data = JSON.parse(saved);
        if (data.batchId || data.activeStep > 0) {
          setActiveStep(data.activeStep || 0);
          setMapping(data.mapping || { name: '', email: '', amount: '', date: '' });
          setTemplate(data.template || { subject: '', html: '', is_html: true });
          setBatchId(data.batchId || null);
          setColumns(data.columns || []);
          setSampleData(data.sampleData || []);
          
          Toast.fire({ 
            icon: 'info', 
            title: 'Session Restored', 
            text: 'Continuing from your last saved progress.',
            timer: 2000 
          });
        }
      } catch (e) {
        console.error("Session recovery failed:", e);
      }
    }
  }, []);

  const clearSession = () => {
    localStorage.removeItem(SESSION_KEY);
    setActiveStep(0);
    setFile(null);
    setColumns([]);
    setSampleData([]);
    setMapping({ name: '', email: '', amount: '', date: '' });
    setTemplate({ subject: '', html: '', is_html: true });
    setBatchId(null);
  };

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

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, maxFiles: 1, multiple: false, accept: { 'text/csv': ['.csv'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } });

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
      clearSession(); // Clear session on success
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
    } else if (!template.is_html && editorRef.current) {
        // Visual Edit mode: use the editor ref to insert at cursor position
        editorRef.current.insertAtCursor(tag);
    } else {
        // HTML Source mode: append to end
        setTemplate(prev => ({ ...prev, html: prev.html + tag }));
    }
  };

  const copyAllTags = () => {
    if (!columns.length) return;
    const tagList = columns.map(c => `{{${c}}}`).join(', ');
    
    navigator.clipboard.writeText(tagList).then(() => {
      Toast.fire({ 
        icon: 'success', 
        title: 'Tags Copied', 
        text: 'All variable tags are now on your clipboard.' 
      });
    });
  };

  const [sampleIdx, setSampleIdx] = useState(0);

  const processPreview = (text: string) => {
    if (!sampleData.length || !text) return text;
    let processed = text;
    const row = sampleData[sampleIdx % sampleData.length];
    
    // Normalize a string: lowercase and remove spaces/underscores/hyphens
    const normalize = (s: string) => s.toLowerCase().replace(/[\s_\-]/g, '');

    // 1. First, replace tags that match the exact column names (Priority)
    columns.forEach(col => {
      const escapedCol = col.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`{{${escapedCol}}}`, 'gi'); // Case-insensitive exact match
      
      let val = row[col];
      // Clean up date artifacts if any
      if (typeof val === 'string' && (val.includes('T00:00:00') || val.includes(' 00:00:00'))) {
        val = val.split('T')[0].split(' ')[0];
      }
      
      processed = processed.replace(regex, `<span style="background: rgba(22, 102, 211, 0.08); color: var(--primary); padding: 0 4px; border-radius: 4px; font-weight: 500;">${String(val || '')}</span>`);
    });

    // 2. Second, replace tags that match normalized column names (Fallback for {{CustomerName}} matching {{Customer Name}})
    const normalizedRow: Record<string, any> = {};
    Object.keys(row).forEach(k => {
      normalizedRow[normalize(k)] = row[k];
    });

    // Find all remaining {{tags}}
    const tags = processed.match(/{{[^{}]+?}}/g) || [];
    tags.forEach(tag => {
      const tagName = tag.replace(/[{}]/g, '').trim();
      const normTag = normalize(tagName);
      if (normalizedRow[normTag]) {
        let val = normalizedRow[normTag];
        if (typeof val === 'string' && (val.includes('T00:00:00') || val.includes(' 00:00:00'))) {
          val = val.split('T')[0].split(' ')[0];
        }
        const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        processed = processed.replace(new RegExp(escapedTag, 'g'), `<span style="background: rgba(22, 102, 211, 0.08); color: var(--primary); padding: 0 4px; border-radius: 4px; font-weight: 500;">${String(val || '')}</span>`);
      }
    });

    return processed;
  };

  const renderContentPrev = () => {
    return processPreview(template.html);
  };

  return (
    <Box className="studio-viewport" sx={{ p: { xs: 1, md: 2 } }}>
      {/* Smart Static Stepper */}
      <Box sx={{ display: 'flex', justifyContent: 'center', mb: 4, mt: 1 }}>
         <Box sx={{ display: 'flex', alignItems: 'center', gap: 0, position: 'relative' }}>
            {steps.map((s, idx) => (
               <Box key={s.id} sx={{ display: 'flex', alignItems: 'center' }}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
                     <Typography 
                        variant="caption" 
                        sx={{ 
                           fontWeight: activeStep === idx ? 700 : 500, 
                           color: activeStep === idx ? 'var(--primary)' : 'var(--text-muted)', 
                           fontSize: '0.65rem', 
                           letterSpacing: '0.1em', 
                           transition: 'all 0.4s ease',
                           opacity: activeStep === idx ? 1 : 0.6,
                           px: { xs: 1.5, md: 3 }
                        }}
                     >
                        {s.label.replace(/^\d+\.\s/, '').toUpperCase()}
                     </Typography>
                     {activeStep === idx && (
                        <Box sx={{ position: 'absolute', bottom: -10, width: '40%', height: 2, bgcolor: 'var(--primary)', borderRadius: '2px', animation: 'studioFadeUp 0.3s' }} />
                     )}
                  </Box>
                  {idx < steps.length - 1 && (
                     <Box sx={{ width: { xs: 20, md: 40 }, height: '1px', bgcolor: 'var(--surface-divider)', mx: 0.5, opacity: 0.5 }} />
                  )}
               </Box>
            ))}
         </Box>
      </Box>

      {/* Stage 1: Discovery */}
      {activeStep === 0 && (
         <Fade in timeout={800}>
           <Box className="studio-canvas" sx={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', animation: 'studioFadeUp 0.8s' }}>
              <Box className="hero-eyebrow" sx={{ mb: 2 }}>DATA DISCOVERY</Box>
              <Typography variant="h2" sx={{ fontWeight: 800, mb: 1, color: 'var(--text-main)', letterSpacing: '-0.04em' }}>
                Securely import <br/>
                <span style={{ color: 'var(--primary)' }}>your network data.</span>
              </Typography>
              <Typography variant="body1" sx={{ color: 'var(--text-muted)', mb: 6, fontWeight: 500 }}>
                Accepting precision CSV and XLSX datasets for global orchestration.
              </Typography>
              
              <Box 
                {...getRootProps()} 
                sx={{ 
                  width: '100%', 
                  maxWidth: 600, 
                  p: 6, 
                  border: '2px dashed', 
                  borderColor: isDragActive ? 'var(--primary)' : 'var(--surface-divider)', 
                  bgcolor: isDragActive ? 'var(--bg-studio)' : 'white',
                  borderRadius: '32px', 
                  cursor: 'pointer', 
                  transition: 'all 0.3s ease',
                  boxShadow: isDragActive ? '0 20px 40px rgba(22,102,211,0.1)' : '0 10px 30px rgba(0,0,0,0.02)',
                  '&:hover': { borderColor: 'var(--primary)', transform: 'translateY(-4px)', boxShadow: '0 20px 40px rgba(0,0,0,0.05)' }
                }}
              >
                <input {...getInputProps()} />
                <Box sx={{ mb: 3 }}><CloudUpload sx={{ fontSize: 48, color: 'var(--primary)' }} /></Box>
                <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>Initiate Global Import</Typography>
                <Typography variant="body2" sx={{ color: 'var(--text-muted)', fontWeight: 500 }}>
                   Drag and drop your outreach dataset here, or click to <br/> browse local storage.
                </Typography>
                {file && (
                  <Typography variant="caption" sx={{ mt: 3, display: 'block', color: 'var(--success)', fontWeight: 800, letterSpacing: '0.05em' }}>
                    RECONCILIATION READY: {file.name.toUpperCase()}
                  </Typography>
                )}
              </Box>
           </Box>
         </Fade>
      )}

      {/* Stage 2: Mapping */}
      {activeStep === 1 && (
         <Fade in timeout={800}>
           <Box className="studio-canvas" sx={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', animation: 'studioFadeUp 0.8s' }}>
              <Box sx={{ mb: 6 }}>
                <Box className="hero-eyebrow" sx={{ mb: 1 }}>ARCHITECTURE RECONCILIATION</Box>
                <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: '-0.02em' }}>Reconcile your <span style={{ color: 'var(--primary)' }}>data variables.</span></Typography>
              </Box>
              
              <Grid container spacing={4} alignItems="stretch">
                 <Grid item xs={12} md={7}>
                    <Paper className="studio-card" sx={{ p: 5, height: '100%', display: 'flex', flexDirection: 'column' }}>
                       <Box display="flex" alignItems="center" gap={1.5} mb={4}>
                          <MappingIcon color="primary" sx={{ fontSize: 20 }} />
                          <Typography variant="subtitle2" sx={{ fontWeight: 800, letterSpacing: '0.05em' }}>PRECISION MATCHING</Typography>
                       </Box>
                       <Grid container spacing={3}>
                         {['name', 'email', 'amount', 'date'].map((f) => (
                           <Grid item xs={12} sm={6} key={f}>
                             <FormControl fullWidth variant="filled" sx={{ '& .MuiFilledInput-root': { borderRadius: '12px', bgcolor: 'var(--bg-studio)' } }}>
                               <InputLabel sx={{ fontWeight: 700, fontSize: '0.75rem' }}>{f.toUpperCase()}</InputLabel>
                               <Select value={mapping[f as keyof typeof mapping]} label={f.toUpperCase()} onChange={(e) => setMapping({ ...mapping, [f]: e.target.value })}>
                                 <MenuItem value=""><em>-- SMART AUTO --</em></MenuItem>
                                 {columns.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                               </Select>
                             </FormControl>
                           </Grid>
                         ))}
                       </Grid>
                       
                       <Box mt="auto" pt={6}>
                          <Button fullWidth variant="contained" className="btn-studio" onClick={handleProcessMapping} disabled={loading || !mapping.email} sx={{ py: 2.2, fontSize: '1rem' }}>
                             {loading ? 'Reconciling Dataset...' : 'Confirm & Access Architect Studio'}
                          </Button>
                       </Box>
                    </Paper>
                 </Grid>

                <Grid item xs={12} md={5}>
                   <Box sx={{ p: 3, borderRadius: '20px', bgcolor: 'var(--primary-glow)', border: '1px solid var(--primary-glow)' }}>
                      <Typography variant="caption" sx={{ fontWeight: 700, color: 'var(--primary)', letterSpacing: '0.1em', fontSize: '0.65rem' }}>LIVE DATA PREVIEW</Typography>
                      <Typography variant="caption" sx={{ display: 'block', color: 'var(--text-muted)', mt: 0.5, fontSize: '0.6rem' }}>Showing first record from your dataset</Typography>
                      <Box sx={{ mt: 2, display: 'grid', gap: 1.5 }}>
                         {Object.keys(mapping).map(k => {
                            const rawVal = sampleData[0]?.[mapping[k as keyof typeof mapping]] || '---';
                            // Clean up date timestamps (remove 00:00:00 artifacts)
                            const cleanVal = typeof rawVal === 'string' ? rawVal.replace(/\s+00:00:00$/, '').replace(/T00:00:00(\.000)?$/, '') : String(rawVal);
                            return (
                               <Box key={k} sx={{ p: 1.5, bgcolor: 'white', borderRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid rgba(0,0,0,0.04)' }}>
                                  <Typography variant="caption" sx={{ fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', fontSize: '0.6rem', letterSpacing: '0.05em' }}>{k}</Typography>
                                  <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8rem', maxWidth: '60%', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cleanVal}</Typography>
                               </Box>
                            );
                         })}
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
          <Box className="studio-canvas" sx={{ animation: 'studioFadeUp 0.8s' }}>
             <Box mb={2}>
                <Box className="hero-eyebrow" sx={{ mb: 0.5 }}>OUTREACH ARCHITECT</Box>
                <Typography variant="h5" sx={{ fontWeight: 600 }}>Design your <span style={{ color: 'var(--primary)' }}>messaging.</span></Typography>
             </Box>

             <Box className="studio-card" sx={{ p: 2, mb: 4, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
                 <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flex: 1, minWidth: 300, maxWidth: 450 }}>
                    <TextField fullWidth size="small" placeholder="Test recipient email..." value={testEmail} onChange={e => setTestEmail(e.target.value)} sx={{ '& .MuiInputBase-root': { borderRadius: '12px' } }} />
                     <Button variant="contained" className="btn-studio" sx={{ px: 3, height: 40 }} onClick={async () => {
                        setTestLoading(true);
                        try { 
                          await axios.post(`${API_BASE}/send_test_email`, { 
                            batch_id: batchId, 
                            test_email: testEmail,
                            custom_subject: template.subject,
                            custom_html: template.html,
                            is_html: template.is_html
                          }); 
                          Toast.fire({ icon: 'success', title: 'Test Dispatched.' }); 
                        }
                        catch(err) { const apiErr = extractApiError(err); Toast.fire({ icon: 'error', title: 'Failed', text: apiErr.message }); }
                        finally { setTestLoading(false); }
                     }} disabled={testLoading || !testEmail || !template.subject?.trim() || !template.html?.trim()}>{testLoading ? '...' : 'Verify'}</Button>
                 </Box>

                 <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                     <Typography variant="caption" sx={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 0.5, letterSpacing: '0.05em', color: 'var(--text-main)' }}>
                        <Visibility color="primary" sx={{ fontSize: 16 }} /> VISUAL INTEL
                     </Typography>
                     {sampleData.length > 1 && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, bgcolor: 'var(--primary-glow)', px: 1, py: 0.2, borderRadius: '999px', border: '1px solid var(--primary)' }}>
                           <IconButton size="small" onClick={() => setSampleIdx(prev => Math.max(0, prev - 1))} disabled={sampleIdx === 0} sx={{ p: 0, color: 'var(--primary)' }}><ArrowBack sx={{ fontSize: 12 }} /></IconButton>
                           <Typography variant="caption" sx={{ fontWeight: 700, fontSize: '0.6rem', color: 'var(--primary)', px: 0.5 }}>{sampleIdx + 1}/{sampleData.length}</Typography>
                           <IconButton size="small" onClick={() => setSampleIdx(prev => Math.min(sampleData.length - 1, prev + 1))} disabled={sampleIdx === sampleData.length - 1} sx={{ p: 0, color: 'var(--primary)' }}><ArrowForward sx={{ fontSize: 12 }} /></IconButton>
                        </Box>
                     )}
                     <Box sx={{ display: 'flex', gap: 0.5, bgcolor: 'var(--bg-studio)', p: 0.5, borderRadius: '8px', border: '1px solid var(--surface-border)' }}>
                        <IconButton size="small" onClick={() => setViewport('desktop')} sx={{ p: 0.5, color: viewport === 'desktop' ? 'var(--primary)' : 'var(--text-muted)' }}><Laptop sx={{ fontSize: 16 }} /></IconButton>
                        <IconButton size="small" onClick={() => setViewport('mobile')} sx={{ p: 0.5, color: viewport === 'mobile' ? 'var(--primary)' : 'var(--text-muted)' }}><Smartphone sx={{ fontSize: 16 }} /></IconButton>
                     </Box>
                     <Chip label={`Visualizing: ${sampleData[sampleIdx]?.[mapping.name] || 'Draft Mode'}`} size="small" sx={{ fontWeight: 600, fontSize: '0.65rem', bgcolor: 'var(--primary-glow)', color: 'var(--primary)', border: '1px solid var(--primary)' }} />
                  </Box>

                  <Box sx={{ display: 'flex', gap: 1 }}>
                     <FormControl size="small" sx={{ minWidth: 180 }}>
                        <InputLabel sx={{ fontSize: '0.75rem', fontWeight: 700 }}>MAGIC THEMES</InputLabel>
                        <Select 
                          label="MAGIC THEMES" 
                          sx={{ borderRadius: '12px', bgcolor: 'white', '& .MuiSelect-select': { py: 1, fontSize: '0.8rem', fontWeight: 600 } }}
                           value={activeTheme}
                          onChange={(e) => {
                             const key = e.target.value as string;
                             setActiveTheme(key);
                             if (key === 'none') {
                                setTemplate({ ...template, html: rawUserBody });
                                Toast.fire({ icon: 'info', title: 'Theme Stripped.', text: 'Restored original content.' });
                                return;
                             }
                             const shell = THEME_SHELLS[key];
                             if (shell) {
                                const styledHtml = shell.replace('{{CONTENT}}', rawUserBody);
                                setTemplate({ ...template, html: styledHtml });
                                Toast.fire({ icon: 'success', title: `${key} Skin Applied.` });
                             }
                          }}
                        >
                           <MenuItem value="none"><em>-- Original Layout (Revert) --</em></MenuItem>
                           {Object.keys(THEME_SHELLS).map(k => <MenuItem key={k} value={k}>{k}</MenuItem>)}
                        </Select>
                     </FormControl>
                     
                     <Box sx={{ display: 'flex', gap: 1, p: 0.5, bgcolor: 'var(--bg-studio)', borderRadius: '16px', border: '1px solid var(--surface-border)' }}>
                        <Button size="small" onClick={() => setTemplate({ ...template, is_html: false })} sx={{ borderRadius: '12px', bgcolor: !template.is_html ? 'white' : 'transparent', color: !template.is_html ? 'var(--primary)' : 'var(--text-muted)', fontWeight: 600, px: 2, boxShadow: !template.is_html ? 'var(--shadow-sm)' : 'none' }}>Visual Edit</Button>
                        <Button size="small" onClick={() => setTemplate({ ...template, is_html: true })} sx={{ borderRadius: '12px', bgcolor: template.is_html ? 'white' : 'transparent', color: template.is_html ? 'var(--primary)' : 'var(--text-muted)', fontWeight: 600, px: 2, boxShadow: template.is_html ? 'var(--shadow-sm)' : 'none' }}>HTML Source</Button>
                     </Box>
                  </Box>
              </Box>

              <Box className="studio-split-pane" sx={{ flex: 1, display: 'flex', gap: 2, overflow: 'hidden' }}>
                {/* Left Pane: Editor */}
                <Box className="studio-pane" sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                   <Paper className="studio-card" sx={{ p: 3, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                      <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                         <TextField fullWidth label="High-Precision Subject" variant="standard" placeholder="e.g., Action Required..." InputProps={{ sx: { fontSize: '1.1rem', fontWeight: 600, pb: 1 } }} error={!template.subject?.trim()} helperText={!template.subject?.trim() ? "Subject required" : ""} value={template.subject} inputRef={subjectRef} onFocus={() => setLastFocused('subject')} onChange={(e) => setTemplate({ ...template, subject: e.target.value })} />
                         {hasPrevious && (
                           <Button size="small" onClick={() => { setTemplate(prevTemplate); Toast.fire({ icon: 'info', title: 'Restored.' }); }} sx={{ ml: 2, whiteSpace: 'nowrap', fontWeight: 700, color: 'var(--primary)', fontSize: '0.65rem' }}>Restore</Button>
                         )}
                      </Box>
                      
                      <Box sx={{ mb: 2, pb: 1, display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'nowrap', overflowX: 'auto', '&::-webkit-scrollbar': { height: '4px' }, '&::-webkit-scrollbar-thumb': { bgcolor: 'var(--surface-divider)', borderRadius: '10px' } }}>
                        {columns.length > 0 && (
                          <Button 
                            variant="outlined" 
                            size="small" 
                            onClick={copyAllTags}
                            sx={{ 
                              height: 28, 
                              borderRadius: '8px', 
                              fontSize: '0.65rem', 
                              px: 1.5, 
                              fontWeight: 800, 
                              textTransform: 'none', 
                              border: '1.5px solid var(--primary)', 
                              color: 'var(--primary)', 
                              flexShrink: 0,
                              '&:hover': { bgcolor: 'var(--primary-glow)', border: '1.5px solid var(--primary)' }
                            }}
                          >
                            Copy All for ChatGPT
                          </Button>
                        )}
                        {columns.map(v => (
                          <Chip key={v} label={`{{${v}}}`} size="small" onClick={() => insertVar(v)} sx={{ height: 28, borderRadius: '8px', fontWeight: 500, fontSize: '0.7rem', bgcolor: 'var(--bg-studio)', border: '1px solid var(--surface-border)', cursor: 'pointer', flexShrink: 0 }} />
                        ))}
                      </Box>
                      
                      <Box sx={{ flex: 1, overflow: 'hidden', mb: 2 }}>
                        {template.is_html ? (
                          <TextField fullWidth multiline placeholder="Start architecting with HTML..." value={template.html} onChange={(e) => { const v = e.target.value; setTemplate({ ...template, html: v }); if (activeTheme === 'none') setRawUserBody(v); }} sx={{ height: '100%', '& .MuiInputBase-root': { fontFamily: "'JetBrains Mono', monospace", fontSize: '0.8rem', bgcolor: '#fbfcfd', borderRadius: '12px', height: '100%', alignItems: 'flex-start', overflow: 'auto' } }} />
                        ) : (
                          <Box sx={{ height: '100%', overflow: 'auto' }}>
                             <RichTextEditor ref={editorRef} value={template.html} onChange={v => { setTemplate({ ...template, html: v }); if (activeTheme === 'none') setRawUserBody(v); }} placeholder="Start architecting..." />
                          </Box>
                        )}
                      </Box>
                      
                      <Box>
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
                               setActiveStep(3); 
                             } finally {
                               setLoading(false);
                             }
                           }} 
                           disabled={!template.subject || !template.html || loading} 
                           sx={{ py: 1.5 }}
                         >
                            {loading ? 'Persisting Design...' : 'Proceed to Final Validation'}
                         </Button>
                      </Box>
                   </Paper>
                </Box>

                {/* Right Pane: Intelligence (Preview) */}
                <Box className="studio-pane" sx={{ flex: 1, overflow: 'hidden' }}>
                    <Paper variant="outlined" sx={{ borderRadius: '24px', overflow: 'hidden', border: '1.5px solid var(--surface-border)', height: '100%', bgcolor: 'white', boxShadow: '0 10px 40px rgba(0,0,0,0.04)', display: 'flex', flexDirection: 'column', transition: 'all 0.3s ease', maxWidth: viewport === 'mobile' ? 375 : '100%', mx: 'auto' }}>
                       <Box sx={{ p: 2, bgcolor: '#fbfcfd', borderBottom: '1px solid var(--surface-divider)' }}>
                          <Typography variant="caption" sx={{ fontWeight: 800, color: 'var(--text-main)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dangerouslySetInnerHTML={{ __html: processPreview(template.subject) || "Drafting subject..." }} />
                       </Box>
                       <Box sx={{ flex: 1, overflow: 'hidden', bgcolor: '#fff', position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                           <iframe 
                             title="preview" 
                             srcDoc={renderContentPrev()} 
                             style={{ 
                                width: viewport === 'desktop' ? '1000px' : '100%', 
                                height: '1000px', 
                                border: 'none', 
                                transform: viewport === 'desktop' ? 'scale(0.5)' : 'none',
                                transformOrigin: 'top center',
                                transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)'
                             }} 
                           />
                       </Box>
                    </Paper>
                </Box>
              </Box>
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
      <Box sx={{ mt: 2, pt: 1, display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--surface-divider)' }}>
         <Box>
           {activeStep > 0 && (
             <Button startIcon={<ArrowBack />} onClick={() => setActiveStep(activeStep - 1)} sx={{ fontWeight: 600, color: 'var(--text-muted)' }}>
                Back
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
