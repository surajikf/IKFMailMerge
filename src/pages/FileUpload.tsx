import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
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
  CircularProgress,
  Tooltip,
  Stack,
  Divider
} from '@mui/material';
import {
  CloudUpload,
  Visibility,
  ArrowBack,
  ArrowForward,
  ContentPaste as MappingIcon,
  Laptop,
  Smartphone,
  Badge as BadgeIcon,
  Schedule as ScheduleIcon,
  Send as SendIcon,
  AttachFile as AttachFileIcon,
  DeleteOutline as DeleteOutlineIcon,
} from '@mui/icons-material';
import RichTextEditor, { RichTextEditorHandle } from '../components/RichTextEditor';
import { extractApiError, getAdminHeaders } from '../utils/api';
import { getSendPreconditionFailure, listUnresolvedMergeTags } from '../utils/mailmergeGuards';

const API_BASE = '/api';
const MIN_BACKEND_VERSION = '2026-03-31-v2-compat';

const Toast = Swal.mixin({
  toast: true,
  position: 'bottom-end',
  showConfirmButton: false,
  timer: 3000,
  timerProgressBar: true,
  background: '#ffffff',
  color: '#0f172a',
});

const DEFAULT_RICH_BODY = 'Hi {{name}},\n\nI hope this email finds you well.\n\nThis is a professional update regarding our recent records. Please let us know if you have any questions.\n\nBest regards,\nIKF Team';
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ALLOWED_ATTACHMENT_EXT = ['pdf', 'xlsx', 'xls', 'csv', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'doc', 'docx', 'txt', 'zip', 'mp3', 'wav', 'm4a'];

type BatchAttachment = {
  id: number;
  batch_id: string;
  original_filename: string;
  mime_type?: string;
  file_size: number;
  created_at: string;
};

const steps = [
  { id: 'Discovery', label: '1. Upload File' },
  { id: 'Mapping', label: '2. Variable Mapping' },
  { id: 'Design', label: '3. Write Email' },
  { id: 'Launch', label: '4. Send & Control' }
];

// Senior QA: THEME_SHELLS removed to focus on Pure Architect (Direct Content)


export default function FileUpload() {
  const [activeStep, setActiveStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [sampleData, setSampleData] = useState<any[]>([]);
  const [mapping, setMapping] = useState({ name: '', email: '', amount: '', date: '' });
  const [template, setTemplate] = useState({ subject: '', html: '', is_html: true });
  const [hasPrevious, setHasPrevious] = useState(false);
  const [prevTemplate, setPrevTemplate] = useState({ subject: '', html: '', is_html: true });
  const [loadingMessage, setLoadingMessage] = useState('Initiating...');
  const [loading, setLoading] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [sampleIdx, setSampleIdx] = useState(0);
  const [testEmail, setTestEmail] = useState('');
  const [testLoading, setTestLoading] = useState(false);
  const [scheduledFor, setScheduledFor] = useState('');
  const [attachments, setAttachments] = useState<BatchAttachment[]>([]);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop');
  const [rawUserBody, setRawUserBody] = useState(DEFAULT_RICH_BODY);
  const subjectRef = useRef<HTMLInputElement>(null);
  const htmlRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<RichTextEditorHandle>(null);
  const [lastFocused, setLastFocused] = useState<'subject' | 'body' | 'html' | null>(null);
  const isMounted = useRef(true);
  const navigate = useNavigate();

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  useEffect(() => {
    if (sampleData.length === 0 && sampleIdx !== 0) {
      setSampleIdx(0);
      return;
    }
    if (sampleIdx > sampleData.length - 1) {
      setSampleIdx(Math.max(0, sampleData.length - 1));
    }
  }, [sampleData.length, sampleIdx]);

  const totalRecipientCount = useMemo(() => {
    if (!mapping.email || sampleData.length === 0) return 0;
    return sampleData.reduce((acc, row) => {
      const emailVal = String(row[mapping.email] || '');
      const count = emailVal.split(',').filter(e => e.trim()).length;
      return acc + (count || 0);
    }, 0);
  }, [sampleData, mapping.email]);

  // Load initial settings for the composer
  useEffect(() => {
    document.title = "IKF MailMerge | Email Builder";
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

  useEffect(() => {
    axios.get(`${API_BASE}/version`)
      .then((res) => {
        const version = String(res?.data?.version || '');
        if (version !== MIN_BACKEND_VERSION) {
          console.warn(`Backend version mismatch. Expected ${MIN_BACKEND_VERSION}, got ${version || 'unknown'}.`);
        }
      })
      .catch(() => {
        // Silent in UI for production sales flow.
      });
  }, []);

  const loadAttachments = useCallback(async () => {
    if (!batchId) {
      setAttachments([]);
      return;
    }
    try {
      const res = await axios.get(`${API_BASE}/batches/${batchId}/attachments`, { headers: getAdminHeaders() });
      setAttachments(res.data || []);
    } catch {
      setAttachments([]);
    }
  }, [batchId]);

  useEffect(() => {
    loadAttachments();
  }, [loadAttachments]);

  const uploadAttachment = async (selected?: File | null) => {
    if (!selected || !batchId) return;
    const ext = (selected.name.split('.').pop() || '').toLowerCase();
    if (!ALLOWED_ATTACHMENT_EXT.includes(ext)) {
      Swal.fire({ icon: 'warning', title: 'Attachment blocked', text: `Allowed types: ${ALLOWED_ATTACHMENT_EXT.join(', ')}` });
      return;
    }
    if (selected.size > MAX_ATTACHMENT_BYTES) {
      Swal.fire({ icon: 'warning', title: 'Attachment too large', text: 'Max 10 MB per attachment.' });
      return;
    }
    setAttachmentUploading(true);
    try {
      const form = new FormData();
      form.append('file', selected);
      await axios.post(`${API_BASE}/batches/${batchId}/attachments`, form, { headers: getAdminHeaders() });
      await loadAttachments();
      Toast.fire({ icon: 'success', title: 'Attachment uploaded' });
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'Upload failed', text: extractApiError(err).message });
    } finally {
      setAttachmentUploading(false);
    }
  };

  const removeAttachment = async (id: number) => {
    if (!batchId) return;
    try {
      await axios.delete(`${API_BASE}/batches/${batchId}/attachments/${id}`, { headers: getAdminHeaders() });
      await loadAttachments();
      Toast.fire({ icon: 'success', title: 'Attachment removed' });
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'Delete failed', text: extractApiError(err).message });
    }
  };

  const loadingMessages = [
    "Reading your file...",
    "Checking columns...",
    "Preparing data...",
    "Matching fields...",
    "Almost done..."
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
        scheduledFor,
        rawUserBody,
      };
      localStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
    }
  }, [activeStep, mapping, template, batchId, columns, sampleData, scheduledFor, rawUserBody]);

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
          if (typeof data.scheduledFor === 'string') setScheduledFor(data.scheduledFor);
          if (typeof data.rawUserBody === 'string') setRawUserBody(data.rawUserBody);

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
    setScheduledFor('');
    setAttachments([]);
    setRawUserBody(DEFAULT_RICH_BODY);
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const selected = acceptedFiles[0];
    if (!selected) return;

    // Senior QA Resilience: File Integrity Guard
    if (selected.size > 10 * 1024 * 1024) {
      Swal.fire({ icon: 'warning', title: 'Dataset Oversized', text: 'Please upload a dataset under 10MB for optimal performance.' });
      return;
    }

    const validTypes = ['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'];
    if (!validTypes.includes(selected.type) && !selected.name.endsWith('.csv') && !selected.name.endsWith('.xlsx')) {
        Swal.fire({ icon: 'error', title: 'Invalid File', text: 'Only .csv and .xlsx files are supported.' });
        return;
    }

    setLoading(true);

    const formData = new FormData();
    formData.append('file', selected);
    try {
      const res = await axios.post(`${API_BASE}/upload`, formData);
      if (!isMounted.current) return;
      
      setFile(selected);
      setBatchId(null);
      setColumns(res.data.columns || []);
      setSampleData(res.data.sample_data || []);
      
      const rec = res.data.recommended_mapping || {};
      const findCol = (keys: string[]) => {
        const cols = res.data.columns || [];
        // Priority 1: Exact Case-Insensitive Match
        const exact = cols.find((c: string) => keys.some(k => c.toLowerCase() === k.toLowerCase()));
        if (exact) return exact;
        // Priority 2: Keyword Heuristic Match
        return cols.find((c: string) => {
          const cl = c.toLowerCase();
          if (keys.includes('name') && cl.includes('id')) return false; // Exclude IDs for names
          return keys.some(k => cl.includes(k));
        }) || '';
      };
      
      setMapping({
        name: rec.name || findCol(['name', 'client', 'recipient', 'customer']),
        email: rec.email || findCol(['email', 'mail', 'to']),
        amount: rec.amount || findCol(['amount', 'total', 'due', 'value', 'balance', 'outstanding']),
        date: rec.date || findCol(['date', 'deadline', 'created', 'due']),
      });
      Toast.fire({ icon: 'success', title: 'File loaded.' });
      setActiveStep(1); 
    } catch (err: any) {
      if (!isMounted.current) return;
      Swal.fire({ icon: 'error', title: 'Upload Failed', text: extractApiError(err).message });
    } finally {
      if (isMounted.current) setLoading(false);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, maxFiles: 1, multiple: false, accept: { 'text/csv': ['.csv'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } });

  const handleProcessMapping = async () => {
    if (loading) console.log("IKF Monitor:", loadingMessage);
    if (!file) return;

    // Mapping Requirement Sanitization
    if (!mapping.email || !mapping.name) {
       Swal.fire({ 
         icon: 'warning', 
         title: 'Missing Required Fields',
         text: 'Name and Email are required.'
       });
       return;
    }

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mapping', JSON.stringify(mapping));
      const res = await axios.post(`${API_BASE}/process_upload`, formData);
      setBatchId(res.data.batch_id);
      setActiveStep(2); 
    } catch (err) {
      const apiErr = extractApiError(err);
      Swal.fire({ icon: 'error', title: 'Mapping Failed', text: apiErr.message || 'Could not reconcile variables.' });
    } finally {
      setLoading(false);
    }
  };

  const handleLaunch = async () => {
    const pre = getSendPreconditionFailure({
      batchId,
      sampleDataLength: sampleData.length,
      scheduledFor,
    });
    if (pre === 'missing_batch') {
      Swal.fire({
        icon: 'warning',
        title: 'Batch not ready',
        text: 'Complete mapping and processing first so a batch exists, then try again.',
      });
      return;
    }
    if (pre === 'no_rows') {
      Swal.fire({ icon: 'info', title: 'Nothing to send', text: 'Your upload has no data rows.' });
      return;
    }
    if (pre === 'invalid_schedule') {
      Swal.fire({
        icon: 'warning',
        title: 'Invalid schedule',
        text: 'Fix the date and time in “Send at”, or clear it to send as soon as possible.',
      });
      return;
    }
    setLoading(true);
    // Finalize the themed template before launch
    // Senior QA: Pure Architect (Shell-Free Content)
    const finalSubject = applyTemplateAliases(template.subject || '');
    const finalBody = ensureHtmlEmail(applyTemplateAliases(template.is_html ? template.html : rawUserBody));
    if (!validateResolvedTemplate(finalSubject, finalBody)) {
      setLoading(false);
      return;
    }

    try {
      await axios.post(`${API_BASE}/send_emails`, { 
        batch_id: batchId,
        custom_subject: finalSubject,
        custom_html: finalBody,
        is_html: true,
        scheduled_for: scheduledFor ? new Date(scheduledFor).toISOString() : null,
        campaign_pacing: null,
      });
      Swal.fire({
        icon: 'success',
        title: 'Send started',
        text:
          'Your batch is queued. The server sends every row that is still pending—open the status page to track progress.',
      });
      clearSession(); // Clear session on success
      navigate(`/status/${batchId}`);
    } catch (err: any) {
      Swal.fire({ icon: 'error', title: 'Send Error', text: extractApiError(err).message });
    } finally {
      setLoading(false);
    }
  };

  const toLocalDateTimeInput = (date: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };

  const applySchedulePreset = (preset: 'now' | 'in1h' | 'tomorrow9' | 'nextMonday9') => {
    const d = new Date();
    if (preset === 'now') {
      setScheduledFor('');
      return;
    }
    if (preset === 'in1h') {
      d.setHours(d.getHours() + 1, 0, 0, 0);
      setScheduledFor(toLocalDateTimeInput(d));
      return;
    }
    if (preset === 'tomorrow9') {
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      setScheduledFor(toLocalDateTimeInput(d));
      return;
    }
    // nextMonday9
    const day = d.getDay(); // 0 Sun ... 6 Sat
    const delta = ((8 - day) % 7) || 7;
    d.setDate(d.getDate() + delta);
    d.setHours(9, 0, 0, 0);
    setScheduledFor(toLocalDateTimeInput(d));
  };

  const insertVar = (tag: string) => {
    // Senior QA: Smart Target Detection
    if (lastFocused === 'subject') {
      const el = subjectRef.current;
      if (el) {
        const start = el.selectionStart || 0;
        const end = el.selectionEnd || 0;
        const sub = template.subject || '';
        const newSub = sub.substring(0, start) + tag + sub.substring(end);
        setTemplate({ ...template, subject: newSub });
        
        // Restore focus and selection
        setTimeout(() => {
          if (subjectRef.current) {
            subjectRef.current.focus();
            subjectRef.current.setSelectionRange(start + tag.length, start + tag.length);
          }
        }, 10);
      }
      return;
    }
    
    // Default: Editor or HTML Source
    if (template.is_html) {
      const el = htmlRef.current;
      if (el) {
        const start = el.selectionStart || 0;
        const end = el.selectionEnd || 0;
        const val = template.html || '';
        const newVal = val.substring(0, start) + tag + val.substring(end);
        setTemplate({ ...template, html: newVal });
        
        // Restore focus for HTML Source
        setTimeout(() => {
          if (htmlRef.current) {
            htmlRef.current.focus();
            htmlRef.current.setSelectionRange(start + tag.length, start + tag.length);
          }
        }, 10);
      }
    } else {
      editorRef.current?.insertAtCursor(tag);
    }
  };

  // --- Intelligence Engine: Safe Rendering & Preview ---
  const ensureHtmlEmail = (content: string) => {
    const input = (content || '').trim();
    if (!input) return '<p style="margin:0;color:#64748b;">No email content yet.</p>';

    // Smart Detection: If it's a full document, Return RAW.
    if (input.toLowerCase().includes('<html') || input.toLowerCase().startsWith('<!doctype')) {
      return input;
    }

    // Otherwise, Wrap in a universal, neutral, professional shell (Inbox fidelity)
    // This provides a standard font stack, max-width, and clean white background.
    const escaped = input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

    const bodyHtml = /<[a-z][\s\S]*>/i.test(input) 
      ? input 
      : escaped.split(/\n{2,}/).map(b => `<p style="margin:0 0 1.2em 0;">${b.trim().replace(/\n/g, '<br/>')}</p>`).join('');

    return `
      <div style="background-color:#ffffff; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; width:100% !important; margin:0; padding:0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px; margin:0 auto; background-color:#ffffff; border:1px solid #e2e8f0; border-radius:0px; overflow:hidden;">
          <tr>
            <td style="padding:40px; color:#1e293b; font-size:16px; line-height:1.6;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:30px; text-align:center; background-color:#f8fafc; color:#64748b; font-size:12px; border-top:1px solid #e2e8f0;">
              <p style="margin:0; font-weight:700; color:#0f172a; font-size:14px;">I Knowledge Factory (IKF)</p>
              <p style="margin:4px 0 0 0;">craft | care | amplify</p>
              <p style="margin-top:16px; opacity:0.6;">© 2026 I Knowledge Factory Pvt. Ltd. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </div>
    `;
  };

  const applyTemplateAliases = (input: string) => {
    if (!input) return input;
    const findColumnByKeywords = (keywords: string[]) =>
      columns.find((col) => keywords.some((k) => col.toLowerCase().includes(k)));
    const companyColumn = findColumnByKeywords(['company', 'organization', 'org', 'firm', 'business']);
    const invoiceNumberColumn = findColumnByKeywords(['invoice number', 'invoice_no', 'invoice no', 'invoice', 'bill no', 'bill number']);
    const replacements: Array<[RegExp, string]> = [
      [/\{\{\s*client\s*name\s*\}\}/gi, mapping.name ? `{{${mapping.name}}}` : 'Customer'],
      [/\{\{\s*recipient\s*\}\}/gi, mapping.name ? `{{${mapping.name}}}` : 'Customer'],
      [/\{\{\s*pending\s*amount\s*\}\}/gi, mapping.amount ? `{{${mapping.amount}}}` : ''],
      [/\{\{\s*amount\s*\}\}/gi, mapping.amount ? `{{${mapping.amount}}}` : ''],
      [/\{\{\s*due\s*date\s*\}\}/gi, mapping.date ? `{{${mapping.date}}}` : ''],
      [/\{\{\s*date\s*\}\}/gi, mapping.date ? `{{${mapping.date}}}` : ''],
      [/\{\{\s*company\s*\}\}/gi, companyColumn ? `{{${companyColumn}}}` : 'Accounts'],
      [/\{\{\s*invoice\s*number\s*\}\}/gi, invoiceNumberColumn ? `{{${invoiceNumberColumn}}}` : 'invoice'],
    ];
    return replacements.reduce((acc, [pattern, value]) => acc.replace(pattern, value), input);
  };

  const getUnresolvedTags = (text: string) => listUnresolvedMergeTags(text, columns);

  const validateResolvedTemplate = (subject: string, body: string) => {
    // Always run alias mapping before validation to avoid false unresolved tags.
    const normalizedSubject = applyTemplateAliases(subject || '');
    const normalizedBody = applyTemplateAliases(body || '');
    const unresolved = [...getUnresolvedTags(normalizedSubject), ...getUnresolvedTags(normalizedBody)];
    const unique = [...new Set(unresolved)];
    if (unique.length === 0) return true;
    Swal.fire({
      icon: 'error',
      title: 'Fix placeholders before send',
      text: `These tags are not in your file columns: ${unique.join(', ')}`,
    });
    return false;
  };

  const processPreview = (html: string) => {
    let res = html;
    const data = sampleData[sampleIdx] || {};

    const AMOUNT_KEYWORDS = ['amount','price','total','fee','cost','balance','outstanding',
      'payable','receivable','bill','invoice','payment','salary','revenue','profit',
      'tax','discount','paid','due','charge','value','rate'];

    const isAmountCol = (colName: string) => {
      const slug = colName.toLowerCase().replace(/[\s_\-]/g, '');
      return AMOUNT_KEYWORDS.some(k => slug.includes(k));
    };

    const formatVal = (val: any, colName?: string) => {
      if (val === undefined || val === null) return ' ';
      const s = String(val);

      // Timestamp string: "2024-01-15 14:30:00" or "2024-01-15T00:00:00"
      const tsMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ]/);
      if (tsMatch) return `${tsMatch[3]}/${tsMatch[2]}/${tsMatch[1].slice(2)}`;

      // Already DD/MM/YYYY or DD/MM/YY
      if (/^\d{2}\/\d{2}\/\d{2,4}$/.test(s)) return s;

      // YYYY-MM-DD (no time)
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        const [y, m, d] = s.split('-');
        return `${d}/${m}/${y.slice(2)}`;
      }

      // Currency formatting — only for amount-like columns
      if (colName && isAmountCol(colName)) {
        const numClean = s.replace(/[,₹$€£\s]/g, '').trim();
        const n = Number(numClean);
        if (!isNaN(n) && numClean !== '') {
          return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
      }

      return s;
    };

    columns.forEach(col => {
      const colVal = formatVal(data[col], col);
      const escapedCol = col.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const escapedVal = String(colVal).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
      const regex = new RegExp(`{{${escapedCol}}}`, 'g');
      res = res.replace(regex, `<span style="background: rgba(22, 102, 211, 0.08); color: #1666d3; padding: 0 4px; border-radius: 4px; font-weight: 500;">${escapedVal}</span>`);
    });

    // Handle Smart Aliases in Preview
    const aliases: Record<string, string> = {
      'Recipient': data[mapping.name] || 'Recipient',
      'Client Name': data[mapping.name] || 'Recipient',
      'Amount': formatVal(data[mapping.amount], mapping.amount) || '0.00',
      'Pending Amount': formatVal(data[mapping.amount], mapping.amount) || '0.00',
      'Date': formatVal(data[mapping.date]) || 'N/A',
      'Due Date': formatVal(data[mapping.date]) || 'N/A',
    };
    Object.entries(aliases).forEach(([k, v]) => {
      const escapedVal = String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
      const regex = new RegExp(`{{${k}}}`, 'gi');
      res = res.replace(regex, `<span style="background: rgba(6, 182, 212, 0.08); color: #0891b2; padding: 0 4px; border-radius: 4px; font-weight: 500;">${escapedVal}</span>`);
    });

    return res;
  };

  const renderContentPrev = () => {
    // Senior QA: High-Fidelity Inbox Simulation (Proper & Stable)
    const safeBody = ensureHtmlEmail(applyTemplateAliases(template.is_html ? template.html : rawUserBody));
    const processed = processPreview(safeBody);
    
    if (processed.toLowerCase().includes('<html') || processed.toLowerCase().startsWith('<!doctype')) {
      return processed;
    }

    // Standardize Email-Friendly Shell for Partial segments
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { 
              margin: 0; padding: 0; 
              background-color: #f3f6f9; 
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
              color: #1e293b;
              line-height: 1.6;
              -webkit-font-smoothing: antialiased;
              overflow-y: auto;
            }
            html {
              height: 100%;
              overflow-y: auto;
            }
            /* Inbox-Fidelity High-Stability Reset */
            p { margin-top: 0; margin-bottom: 1.25em; }
            ul, ol { margin-top: 0; margin-bottom: 1.25em; padding-left: 1.5em; }
            img { max-width: 100%; height: auto; }
            table { width: 100% !important; border-collapse: collapse; }
            td, th { word-break: break-word; overflow-wrap: anywhere; }
            * { max-width: 100%; overflow-wrap: anywhere; }
            a { color: #1666d3; text-decoration: underline; }
          </style>
        </head>
        <body>
          ${processed}
        </body>
      </html>
    `;
  };

  const previewSubjectHtml = useMemo(() => processPreview(template.subject || ''), [template.subject, sampleData, sampleIdx, columns, mapping]);
  const previewSrcDoc = useMemo(() => renderContentPrev(), [template.is_html, template.html, rawUserBody, sampleData, sampleIdx, columns, mapping]);

  return (
    <Box
      className="studio-viewport"
      sx={{
        p: { xs: 1, md: 2 },
        height: 'auto',
        minHeight: '100vh',
        overflowY: 'auto',
      }}
    >
      {/* Step rail — soft, readable */}
      <Box sx={{ display: 'flex', justifyContent: 'center', mb: 4, mt: { xs: 0.5, md: 1.5 } }}>
         <Box
           sx={{
             display: 'flex',
             alignItems: 'center',
             flexWrap: 'wrap',
             justifyContent: 'center',
             gap: 0,
             px: { xs: 1.5, md: 3 },
             py: { xs: 1.75, md: 2 },
             borderRadius: '999px',
             bgcolor: 'rgba(255, 255, 255, 0.72)',
             border: '1px solid rgba(226, 232, 240, 0.85)',
             boxShadow: '0 4px 24px rgba(15, 23, 42, 0.05), inset 0 1px 0 rgba(255,255,255,0.9)',
           }}
         >
            {steps.map((s, idx) => (
               <Box key={s.id} sx={{ display: 'flex', alignItems: 'center' }}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
                     <Typography 
                        variant="caption" 
                        sx={{ 
                           fontWeight: activeStep === idx ? 800 : 600, 
                           color: activeStep === idx ? 'var(--primary)' : '#64748b', 
                           fontSize: { xs: '0.68rem', md: '0.78rem' }, 
                           letterSpacing: { xs: '0.06em', md: '0.09em' }, 
                           transition: 'all 0.35s ease',
                           px: { xs: 1.25, md: 2.5 },
                           lineHeight: 1.3,
                        }}
                     >
                        {s.label.replace(/^\d+\.\s/, '').toUpperCase()}
                     </Typography>
                     {activeStep === idx && (
                        <Box sx={{ position: 'absolute', bottom: -8, width: '42%', height: 3, background: 'linear-gradient(90deg, var(--primary), #38bdf8)', borderRadius: 4, opacity: 0.95, animation: 'studioFadeUp 0.35s ease' }} />
                     )}
                  </Box>
                  {idx < steps.length - 1 && (
                     <Box sx={{ width: { xs: 16, md: 28 }, height: 2, mx: { xs: 0.25, md: 0.5 }, borderRadius: 2, background: 'linear-gradient(90deg, transparent, rgba(148,163,184,0.45), transparent)' }} />
                  )}
               </Box>
            ))}
         </Box>
      </Box>

      {/* Stage 1: Discovery */}
      {activeStep === 0 && (
         <Fade in timeout={800}>
           <Box className="studio-canvas" sx={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', animation: 'studioFadeUp 0.8s' }}>
              <Box
                sx={{
                  width: '100%',
                  maxWidth: 1080,
                  p: { xs: 3, md: 6 },
                  borderRadius: '40px',
                  position: 'relative',
                  overflow: 'hidden',
                  border: '1px solid rgba(255,255,255,0.82)',
                  background: 'linear-gradient(135deg, #f9fbff 0%, #eef4ff 42%, #f6fbff 100%)',
                  boxShadow: '0 24px 60px rgba(15, 23, 42, 0.1), inset 0 1px 0 rgba(255,255,255,0.9)',
                }}
              >
                <Box
                  sx={{
                    position: 'absolute',
                    top: 24,
                    right: 26,
                    width: 140,
                    height: 140,
                    borderRadius: '30px',
                    background: 'linear-gradient(135deg, rgba(22,102,211,0.14), rgba(56,189,248,0.16))',
                    border: '1px solid rgba(255,255,255,0.7)',
                    boxShadow: '0 14px 34px rgba(22,102,211,0.12)',
                    transform: 'rotate(8deg)',
                    animation: 'studioFloatCardA 7s ease-in-out infinite',
                    pointerEvents: 'none',
                  }}
                />
                <Box
                  sx={{
                    position: 'absolute',
                    bottom: 22,
                    left: 24,
                    width: 110,
                    height: 110,
                    borderRadius: '26px',
                    background: 'linear-gradient(135deg, rgba(99,102,241,0.13), rgba(22,102,211,0.09))',
                    border: '1px solid rgba(255,255,255,0.72)',
                    boxShadow: '0 12px 28px rgba(99,102,241,0.1)',
                    transform: 'rotate(-10deg)',
                    animation: 'studioFloatCardB 8.5s ease-in-out infinite',
                    pointerEvents: 'none',
                  }}
                />
                <Box
                  sx={{
                    position: 'absolute',
                    inset: -80,
                    background: 'radial-gradient(circle at 18% 30%, rgba(56,189,248,0.2), transparent 42%), radial-gradient(circle at 78% 62%, rgba(22,102,211,0.2), transparent 44%)',
                    animation: 'studioFloatGlow 10s ease-in-out infinite',
                    pointerEvents: 'none',
                  }}
                />
                <Box
                  sx={{
                    position: 'relative',
                    zIndex: 1,
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', md: '1.08fr 0.92fr' },
                    gap: { xs: 3, md: 5 },
                    alignItems: 'center',
                  }}
                >
                  <Box sx={{ textAlign: { xs: 'center', md: 'left' } }}>
                    <Box className="hero-eyebrow" sx={{ mb: 2 }}>UPLOAD & LAUNCH</Box>
                    <Typography variant="h2" sx={{ fontWeight: 800, mb: 1.2, color: 'var(--text-main)', letterSpacing: '-0.045em', fontSize: { xs: '2rem', md: '3rem' }, lineHeight: 1.06 }}>
                      Beautiful batch email
                      <br />
                      workflow, <span style={{ color: 'var(--primary)' }}>ready in minutes.</span>
                    </Typography>
                    <Typography variant="body1" sx={{ color: 'var(--text-muted)', mb: 3, fontWeight: 500, maxWidth: 520, mx: { xs: 'auto', md: 0 } }}>
                      Drop your CSV/XLSX, auto-map fields, and launch polished campaigns with full control and live status tracking.
                    </Typography>
                    <Box
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                        gap: 1,
                        mb: 2.6,
                        maxWidth: 420,
                        mx: { xs: 'auto', md: 0 },
                      }}
                    >
                      {[
                        { k: 'Fast Setup', v: '2 min' },
                        { k: 'Smart Mapping', v: 'Auto' },
                        { k: 'Batch Control', v: 'Live' },
                      ].map((it) => (
                        <Box
                          key={it.k}
                          sx={{
                            p: 1.2,
                            borderRadius: '14px',
                            bgcolor: 'rgba(255,255,255,0.78)',
                            border: '1px solid rgba(226,232,240,0.9)',
                            boxShadow: '0 6px 20px rgba(15,23,42,0.05)',
                          }}
                        >
                          <Typography variant="caption" sx={{ color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.02em', display: 'block' }}>
                            {it.k}
                          </Typography>
                          <Typography variant="subtitle2" sx={{ color: 'var(--text-main)', fontWeight: 800 }}>
                            {it.v}
                          </Typography>
                        </Box>
                      ))}
                    </Box>
                    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1, justifyContent: { xs: 'center', md: 'flex-start' } }}>
                      <Chip size="small" label="CSV / XLSX" sx={{ fontWeight: 700, bgcolor: 'rgba(255,255,255,0.92)' }} />
                      <Chip size="small" label="Auto Mapping" sx={{ fontWeight: 700, bgcolor: 'rgba(255,255,255,0.92)' }} />
                      <Chip size="small" label="Secure by Design" sx={{ fontWeight: 700, bgcolor: 'rgba(255,255,255,0.92)' }} />
                    </Stack>
                  </Box>

                  <Box
                    {...getRootProps()}
                    sx={{
                      width: '100%',
                      p: { xs: 4, md: 4.5 },
                      border: '2px dashed',
                      borderColor: isDragActive ? 'var(--primary)' : 'rgba(22,102,211,0.24)',
                      bgcolor: isDragActive ? 'rgba(255,255,255,0.98)' : 'rgba(255,255,255,0.88)',
                      borderRadius: '28px',
                      cursor: 'pointer',
                      transition: 'all 0.3s ease',
                      backdropFilter: 'blur(5px)',
                      boxShadow: isDragActive ? '0 18px 44px rgba(22,102,211,0.13)' : '0 10px 28px rgba(0,0,0,0.05)',
                      position: 'relative',
                      '&:hover': { borderColor: 'var(--primary)', transform: 'translateY(-3px)', boxShadow: '0 18px 38px rgba(22,102,211,0.12)' }
                    }}
                  >
                    <input {...getInputProps()} />
                    <Box sx={{ mb: 2.2, display: 'inline-flex', p: 1.5, borderRadius: '16px', bgcolor: 'rgba(22,102,211,0.1)', animation: 'studioPulse 2.2s ease-in-out infinite' }}>
                      <CloudUpload sx={{ fontSize: 42, color: 'var(--primary)' }} />
                    </Box>
                    <Typography variant="h6" sx={{ fontWeight: 800, mb: 0.6 }}>Drag & drop your file</Typography>
                    <Typography variant="body2" sx={{ color: 'var(--text-muted)', fontWeight: 500 }}>
                      or click to browse from your computer.
                    </Typography>
                    {file && (
                      <Typography variant="caption" sx={{ mt: 2.2, display: 'block', color: 'var(--success)', fontWeight: 800, letterSpacing: '0.04em' }}>
                        READY: {file.name.toUpperCase()}
                      </Typography>
                    )}
                    <Typography variant="caption" sx={{ mt: 1.1, display: 'block', color: 'var(--text-muted)', fontWeight: 600 }}>
                      Max file size: 10 MB
                    </Typography>
                  </Box>
                </Box>
              </Box>
           </Box>
         </Fade>
      )}

      {/* Stage 2: Mapping */}
      {activeStep === 1 && (
         <Fade in timeout={800}>
           <Box className="studio-canvas" sx={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', animation: 'studioFadeUp 0.8s' }}>
              <Box sx={{ mb: 6 }}>
                <Box className="hero-eyebrow" sx={{ mb: 1 }}>MAP COLUMNS</Box>
                <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: '-0.02em' }}>Match your file columns to <span style={{ color: 'var(--primary)' }}>email fields.</span></Typography>
              </Box>
              
              <Grid container spacing={3} alignItems="stretch" justifyContent="center">
                 <Grid item xs={12} md={6.5}>
                    <Paper className="studio-card" sx={{ p: 4, height: '100%', display: 'flex', flexDirection: 'column' }}>
                       <Box display="flex" alignItems="center" gap={1.5} mb={3}>
                          <MappingIcon color="primary" sx={{ fontSize: 20 }} />
                          <Typography variant="subtitle2" sx={{ fontWeight: 800, letterSpacing: '0.05em' }}>COLUMN MATCHING</Typography>
                       </Box>
                       <Grid container spacing={2}>
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
                       
                       <Box mt="auto" pt={4}>
                          <Button fullWidth variant="contained" className="btn-studio" onClick={handleProcessMapping} disabled={loading || !mapping.email} sx={{ py: 2, fontSize: '0.95rem' }}>
                             {loading ? 'Processing file...' : 'Continue to Email Editor'}
                          </Button>
                       </Box>
                    </Paper>
                 </Grid>

                <Grid item xs={12} md={5.5}>
                   <Box sx={{ p: 4, height: '100%', borderRadius: '24px', bgcolor: 'var(--primary-glow)', border: '1px solid var(--surface-divider)', display: 'flex', flexDirection: 'column' }}>
                      <Typography variant="caption" sx={{ fontWeight: 800, color: 'var(--primary)', letterSpacing: '0.1em', fontSize: '0.7rem' }}>FILE PREVIEW</Typography>
                      <Typography variant="caption" sx={{ display: 'block', color: 'var(--text-muted)', mt: 0.5, mb: 3, fontSize: '0.65rem' }}>Showing first row from your file</Typography>
                      <Box sx={{ display: 'grid', gap: 1.5 }}>
                         {Object.keys(mapping).map(k => {
                            const rawVal = sampleData[0]?.[mapping[k as keyof typeof mapping]] || '---';
                            const cleanVal = typeof rawVal === 'string' ? rawVal.replace(/\s+00:00:00$/, '').replace(/T00:00:00(\.000)?$/, '') : String(rawVal);
                            return (
                               <Box key={k} sx={{ p: 1.8, bgcolor: 'white', borderRadius: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid rgba(0,0,0,0.03)' }}>
                                  <Typography variant="caption" sx={{ fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', fontSize: '0.6rem', letterSpacing: '0.04em' }}>{k}</Typography>
                                  <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.85rem', maxWidth: '60%', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cleanVal}</Typography>
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
          <Box className="studio-canvas" sx={{ animation: 'studioFadeUp 0.8s', display: 'flex', flexDirection: 'column' }}>
             
             {/* COMPACT STUDIO TOOLBAR: Senior QA Space Optimization */}
             <Paper 
                variant="outlined" 
                sx={{ 
                   p: 1.5, 
                   mb: 2, 
                   borderRadius: '20px', 
                   bgcolor: 'rgba(255,255,255,0.95)', 
                   backdropFilter: 'blur(8px)',
                   border: '1.5px solid var(--surface-divider)', 
                   display: 'flex', 
                   alignItems: 'center', 
                   justifyContent: 'space-between', 
                   gap: 3,
                   boxShadow: '0 4px 20px rgba(0,0,0,0.03)',
                   position: 'sticky',
                   top: 20,
                   zIndex: 100
                }}
             >
                {/* 1. IDENTITY & VERIFICATION */}
                <Box display="flex" alignItems="center" gap={1.2} sx={{ flex: 1, minWidth: 280, maxWidth: 520 }}>
                   <Box sx={{ p: 1, bgcolor: 'var(--primary-glow)', borderRadius: '12px' }}><BadgeIcon color="primary" sx={{ fontSize: 20 }} /></Box>
                   <TextField 
                      fullWidth 
                      size="small" 
                      placeholder="Test recipient email..." 
                      value={testEmail} 
                      onChange={e => setTestEmail(e.target.value)} 
                      sx={{ '& .MuiInputBase-root': { borderRadius: '12px', bgcolor: 'var(--bg-studio)', border: 'none' } }} 
                   />
                   <Button 
                      variant="contained" 
                      className="btn-studio" 
                      sx={{ px: 3, height: 40, minWidth: 100, borderRadius: '12px', fontWeight: 900 }} 
                      onClick={async () => {
                         if (!testEmail || !template.subject?.trim()) {
                            Toast.fire({ icon: 'warning', title: 'Input Required' });
                            return;
                         }
                         setTestLoading(true);
                         const finalSubject = applyTemplateAliases(template.subject || '');
                         const finalBody = ensureHtmlEmail(applyTemplateAliases(template.is_html ? template.html : rawUserBody));
                         if (!validateResolvedTemplate(finalSubject, finalBody)) {
                           setTestLoading(false);
                           return;
                         }
                         try { 
                           await axios.post(`${API_BASE}/send_test_email`, { 
                             batch_id: batchId, 
                             test_email: testEmail,
                             custom_subject: finalSubject,
                             custom_html: finalBody,
                             is_html: true
                           }); 
                           Toast.fire({ icon: 'success', title: 'Test Dispatched.' }); 
                         }
                         catch(err) { const apiErr = extractApiError(err); Toast.fire({ icon: 'error', title: 'Failed', text: apiErr.message }); }
                         finally { setTestLoading(false); }
                      }} 
                      disabled={testLoading || !testEmail}
                   >
                      {testLoading ? <CircularProgress size={16} color="inherit" /> : 'TEST'}
                   </Button>
                   <Button
                      component="label"
                      variant="outlined"
                      size="small"
                      disabled={!batchId || attachmentUploading}
                      sx={{ height: 40, borderRadius: '12px', fontWeight: 800, textTransform: 'none', minWidth: 118 }}
                   >
                      {attachmentUploading ? 'Uploading...' : 'Attach'}
                      <input hidden type="file" onChange={(e) => uploadAttachment(e.target.files?.[0])} />
                   </Button>
                   <Chip
                      size="small"
                      label={`${attachments.length} file${attachments.length === 1 ? '' : 's'}`}
                      sx={{ fontWeight: 800, height: 24 }}
                   />
                </Box>

                {/* 2. VISUAL INTEL & VIEWPORTS */}
                <Box display="flex" alignItems="center" gap={2} sx={{ px: 2, borderLeft: '1px solid var(--surface-divider)', borderRight: '1px solid var(--surface-divider)' }}>
                   <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Visibility color="primary" sx={{ fontSize: 18 }} />
                      <Typography variant="caption" sx={{ fontWeight: 800, color: 'var(--text-main)', letterSpacing: '0.05em' }}>PREVIEW</Typography>
                   </Box>
                   {sampleData.length > 1 && (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, bgcolor: 'var(--primary-glow)', px: 1, py: 0.2, borderRadius: '999px', border: '1px solid var(--primary)' }}>
                         <IconButton size="small" onClick={() => setSampleIdx((prev: number) => Math.max(0, prev - 1))} disabled={sampleIdx === 0} sx={{ p: 0, color: 'var(--primary)' }}><ArrowBack sx={{ fontSize: 12 }} /></IconButton>
                         <Typography variant="caption" sx={{ fontWeight: 900, fontSize: '0.65rem', color: 'var(--primary)', px: 0.5 }}>{sampleIdx + 1}/{sampleData.length}</Typography>
                         <IconButton size="small" onClick={() => setSampleIdx((prev: number) => Math.min(sampleData.length - 1, prev + 1))} disabled={sampleIdx === sampleData.length - 1} sx={{ p: 0, color: 'var(--primary)' }}><ArrowForward sx={{ fontSize: 12 }} /></IconButton>
                      </Box>
                   )}
                   <Box sx={{ display: 'flex', gap: 0.5, bgcolor: 'var(--bg-studio)', p: 0.4, borderRadius: '10px', border: '1px solid var(--surface-border)' }}>
                      <IconButton size="small" onClick={() => setViewport('desktop')} sx={{ p: 0.5, borderRadius: '8px', bgcolor: viewport === 'desktop' ? 'white' : 'transparent', color: viewport === 'desktop' ? 'var(--primary)' : 'var(--text-muted)', boxShadow: viewport === 'desktop' ? '0 2px 8px rgba(0,0,0,0.05)' : 'none' }}><Laptop sx={{ fontSize: 16 }} /></IconButton>
                      <IconButton size="small" onClick={() => setViewport('mobile')} sx={{ p: 0.5, borderRadius: '8px', bgcolor: viewport === 'mobile' ? 'white' : 'transparent', color: viewport === 'mobile' ? 'var(--primary)' : 'var(--text-muted)', boxShadow: viewport === 'mobile' ? '0 2px 8px rgba(0,0,0,0.05)' : 'none' }}><Smartphone sx={{ fontSize: 16 }} /></IconButton>
                   </Box>
                </Box>

                {/* 3. WORKSPACE LOGIC */}
                <Box display="flex" alignItems="center" gap={1.5}>
                   {/* DESIGN INTELLIGENCE CHIP */}
                   <Chip 
                      label={(!template.subject?.trim() || (template.is_html ? !template.html : !rawUserBody)) ? 'DESIGN DEFICIT' : 'OPTIMIZED'} 
                      size="small" 
                      color={(!template.subject?.trim() || (template.is_html ? !template.html : !rawUserBody)) ? 'error' : 'success'}
                      sx={{ 
                         height: 24, 
                         fontSize: '0.6rem', 
                         fontWeight: 900, 
                         letterSpacing: '0.05em',
                         px: 0.5,
                         animation: (!template.subject?.trim() || (template.is_html ? !template.html : !rawUserBody)) ? 'pulse 2s infinite' : 'none'
                      }} 
                   />
                   
                   <Box sx={{ display: 'flex', bgcolor: 'var(--bg-studio)', p: 0.4, borderRadius: '12px', border: '1px solid var(--surface-divider)' }}>
                      <Button 
                         size="small" 
                         onClick={() => { setTemplate({ ...template, is_html: false }); setLastFocused('body'); }}
                         sx={{ 
                            px: 2, 
                            height: 32,
                            fontSize: '0.65rem', 
                            fontWeight: 800, 
                            borderRadius: '10px', 
                            color: !template.is_html ? 'var(--primary)' : 'var(--text-muted)',
                            bgcolor: !template.is_html ? 'white' : 'transparent',
                            boxShadow: !template.is_html ? '0 2px 8px rgba(0,0,0,0.05)' : 'none',
                            '&:hover': { bgcolor: !template.is_html ? 'white' : 'rgba(0,0,0,0.02)' }
                         }}
                      >
                         VISUAL EDIT
                      </Button>
                      <Button 
                         size="small" 
                         onClick={() => { setTemplate({ ...template, is_html: true, html: rawUserBody }); setLastFocused('html'); }}
                         sx={{ 
                            px: 2, 
                            height: 32,
                            fontSize: '0.65rem', 
                            fontWeight: 800, 
                            borderRadius: '10px', 
                            color: template.is_html ? 'var(--primary)' : 'var(--text-muted)',
                            bgcolor: template.is_html ? 'white' : 'transparent',
                            boxShadow: template.is_html ? '0 2px 8px rgba(0,0,0,0.05)' : 'none',
                            '&:hover': { bgcolor: template.is_html ? 'white' : 'rgba(0,0,0,0.02)' }
                         }}
                      >
                         HTML SOURCE
                      </Button>
                   </Box>
                </Box>
             </Paper>

             <Box 
               className="studio-split-pane" 
               sx={{ 
                 flex: 1, 
                 display: 'flex', 
                 flexDirection: { xs: 'column', md: 'row' }, 
                 gap: 3, 
                 overflow: 'hidden', 
                 minHeight: { xs: 'auto', md: '600px' } 
               }}
             >
                    {/* Left Pane: Editor */}
                    <Box className="studio-pane" sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: { xs: '600px', md: 'auto' } }}>
                       <Paper className="studio-card" sx={{ p: 3, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                          <Box sx={{ mb: 3.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                             <TextField 
                               fullWidth 
                               label="Subject"
                               variant="standard" 
                               placeholder="e.g., Action Required..." 
                               InputProps={{ 
                                 sx: { 
                                   fontSize: '1.15rem', 
                                   fontWeight: 700, 
                                   pb: 1.5,
                                   fontFamily: 'var(--studio-font-main)',
                                   letterSpacing: '-0.01em'
                                 } 
                               }} 
                               error={!template.subject?.trim()} 
                               helperText={!template.subject?.trim() ? "Subject required" : ""} 
                               value={template.subject} 
                               inputRef={subjectRef} 
                               onFocus={() => setLastFocused('subject')} 
                               onChange={(e) => { const v = e.target.value; setTemplate({ ...template, subject: v }); }} 
                             />
                             {hasPrevious && (
                               <Button 
                                 variant="text"
                                 size="small" 
                                 onClick={() => { 
                                   setTemplate(prevTemplate); 
                                   setRawUserBody(prevTemplate.html);
                                   Toast.fire({ icon: 'info', title: 'Design Restored' }); 
                                 }} 
                                 sx={{ 
                                   ml: 2, 
                                   height: 'fit-content',
                                   whiteSpace: 'nowrap', 
                                   fontWeight: 800, 
                                   color: 'var(--primary)', 
                                   fontSize: '0.6rem',
                                   letterSpacing: '0.05em',
                                   textTransform: 'uppercase'
                                 }}
                               >
                                Load Saved
                               </Button>
                             )}
                          </Box>

                           <Box sx={{ p: 2.5, bgcolor: '#fbfcfd', borderBottom: '1px solid var(--surface-divider)' }}>
                              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
                                <Typography variant="caption" sx={{ fontWeight: 900, color: 'var(--text-muted)', mr: 1, fontSize: '0.6rem', letterSpacing: '0.05em' }}>FILE COLUMNS</Typography>
                                {columns.map(v => {
                                  const tag = `{{${v}}}`;
                                  return (
                                    <Tooltip key={v} title="Click to insert & copy">
                                      <Chip 
                                        label={tag} 
                                        size="small" 
                                        onClick={() => {
                                          insertVar(tag);
                                          navigator.clipboard.writeText(tag);
                                          Toast.fire({ icon: 'success', title: 'Tag Copied', timer: 800 });
                                        }} 
                                        sx={{ 
                                          height: 26, 
                                          borderRadius: '8px', 
                                          fontWeight: 600, 
                                          fontSize: '0.65rem', 
                                          bgcolor: 'white', 
                                          border: '1px solid var(--surface-border)', 
                                          cursor: 'pointer',
                                          '&:hover': { bgcolor: 'var(--primary-glow)', transform: 'translateY(-1px)' }
                                        }} 
                                      />
                                    </Tooltip>
                                  );
                                })}
                              </Box>
                           </Box>

                          <Box
                            sx={{
                              mb: 2,
                              flex: 1,
                              minHeight: 260,
                              maxHeight: 420,
                              overflow: 'hidden',
                            }}
                          >
                             {template.is_html ? (
                               <TextField 
                                 fullWidth 
                                 multiline 
                                 placeholder="Write or paste HTML..." 
                                 value={template.html} 
                                 inputRef={htmlRef}
                                 onFocus={() => setLastFocused('html')}
                                 onChange={(e) => { 
                                   const v = e.target.value; 
                                   setTemplate({ ...template, html: v }); 
                                 }} 
                                 sx={{ 
                                   height: '100%',
                                   '& .MuiInputBase-root': { 
                                     fontFamily: "'JetBrains Mono', monospace", 
                                     fontSize: '0.85rem', 
                                     bgcolor: '#fbfcfd', 
                                     borderRadius: '12px', 
                                     height: '100%', 
                                     alignItems: 'flex-start', 
                                     overflowY: 'auto', 
                                     overflowX: 'hidden',
                                   } 
                                 }} 
                               />
                             ) : (
                              <Box sx={{ height: '100%', overflowY: 'auto', overflowX: 'hidden' }}>
                                  <RichTextEditor 
                                    ref={editorRef} 
                                    value={rawUserBody} 
                                    onChange={v => { 
                                      setRawUserBody(v);
                                    }} 
                                    placeholder="Write your email..." 
                                  />
                               </Box>
                             )}
                          </Box>
                       </Paper>
                    </Box>

                    {/* Right Pane: Intelligence (Preview) */}
                    <Box 
                      className="studio-pane" 
                      sx={{ 
                        flex: 1, 
                        position: 'relative',
                        top: 0,
                        height: { xs: 'auto', md: '100%' }, 
                        minHeight: { xs: 420, md: 0 },
                        overflow: 'hidden' 
                      }}
                    >
                        <Paper variant="outlined" sx={{ borderRadius: '24px', overflow: 'hidden', border: '1.5px solid var(--surface-border)', height: '100%', minHeight: 0, bgcolor: 'white', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 20px rgba(0,0,0,0.03)' }}>
                            <Box sx={{ p: 2, py: 3, bgcolor: '#fbfcfd', borderBottom: '1px solid var(--surface-divider)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                               <Box display="flex" alignItems="center" gap={1.5}>
                                  <Typography variant="caption" sx={{ fontWeight: 900, color: 'var(--text-main)', letterSpacing: '0.1em', fontSize: '0.65rem' }}>EMAIL PREVIEW · {viewport.toUpperCase()}</Typography>
                               </Box>
                               <Fade in={!!sampleData[sampleIdx]}>
                                 <Chip 
                                   label={`Recipient: ${sampleData[sampleIdx]?.[mapping.name] || 'Sample User'}`}
                                   size="small" 
                                   sx={{ 
                                     height: 22, 
                                     fontSize: '0.6rem', 
                                     fontWeight: 800, 
                                     bgcolor: 'white',
                                     color: 'var(--primary)', 
                                     border: '1px solid var(--surface-border)',
                                     boxShadow: 'var(--studio-shadow-sm)',
                                     letterSpacing: '0.02em'
                                   }} 
                                 />
                               </Fade>
                            </Box>
                                <Box sx={{ p: 2.5, bgcolor: '#fbfcfd', borderBottom: '1px solid var(--surface-divider)' }}>
                                   <Typography variant="caption" sx={{ fontWeight: 800, color: 'var(--text-muted)', fontSize: '0.6rem', display: 'block', mb: 0.5, letterSpacing: '0.05em' }}>SUBJECT LINE</Typography>
                                   <Typography variant="body2" sx={{ fontWeight: 700, color: 'var(--text-main)', fontSize: '0.9rem' }}>
                                     <span dangerouslySetInnerHTML={{ __html: previewSubjectHtml }} />
                                   </Typography>
                                </Box>
                                <Box 
                                  sx={{ 
                                    flex: 1, 
                                    minHeight: 0,
                                    maxHeight: { xs: 520, md: 'calc(100vh - 340px)' },
                                    overflowY: 'auto', 
                                    p: 0, 
                                    position: 'relative', 
                                    bgcolor: '#f1f5f9',
                                    display: 'flex',
                                    justifyContent: 'center',
                                    '&::-webkit-scrollbar': { width: '8px' },
                                    '&::-webkit-scrollbar-thumb': { bgcolor: '#cbd5e1', borderRadius: '4px' }
                                  }}
                                >
                                 <iframe 
                                   title="preview" 
                                   srcDoc={previewSrcDoc}
                                   style={{
                                      overflow: 'auto',
                                      width: '100%',
                                      maxWidth: viewport === 'desktop' ? 900 : 420,
                                      height: '100%',
                                      minHeight: 520,
                                      border: 'none', 
                                      overflowY: 'auto',
                                      transform: 'none',
                                      transformOrigin: 'top center',
                                      transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                                      backgroundColor: '#f1f5f9'
                                   }} 
                                 />
                                </Box>
                        </Paper>
                    </Box>
                 </Box>

          </Box>
        </Fade>
      )}

      {/* Stage 4: Launch — wide layout aligned with other steps */}
      {activeStep === 3 && (
        <Fade in timeout={500}>
          <Box sx={{ py: { xs: 2, md: 4 }, px: { xs: 1.5, sm: 2, md: 3 } }}>
            <Paper
              elevation={0}
              className="studio-card"
              sx={{
                maxWidth: 1240,
                mx: 'auto',
                p: { xs: 3, sm: 4, md: 5 },
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--surface-border)',
                boxShadow: 'var(--shadow-premium)',
              }}
            >
              <Grid container spacing={{ xs: 4, md: 5 }}>
                <Grid item xs={12}>
                  <Box sx={{ maxWidth: 720 }}>
                    <Typography
                      variant="overline"
                      sx={{ color: 'var(--text-muted)', fontWeight: 800, letterSpacing: '0.14em', display: 'block' }}
                    >
                      Step 4 · Send
                    </Typography>
                    <Typography
                      variant="h4"
                      component="h2"
                      sx={{ fontWeight: 800, mt: 0.75, letterSpacing: '-0.03em', color: 'var(--text-main)' }}
                    >
                      Ready to send
                    </Typography>
                    <Typography variant="body1" sx={{ color: 'var(--text-muted)', mt: 1.5, lineHeight: 1.7 }}>
                      Confirm the summary, optionally pick a send time, then dispatch. You can go back to edit the message anytime.
                    </Typography>
                  </Box>
                </Grid>

                <Grid item xs={12} md={7}>
                  <Typography variant="caption" sx={{ color: 'var(--text-muted)', fontWeight: 800, letterSpacing: '0.1em', display: 'block', mb: 2 }}>
                    SUMMARY
                  </Typography>
                  <Box
                    sx={{
                      borderRadius: 2,
                      border: '1px solid var(--surface-divider)',
                      bgcolor: 'rgba(248, 250, 252, 0.95)',
                      overflow: 'hidden',
                    }}
                  >
                    <Stack
                      direction={{ xs: 'column', sm: 'row' }}
                      spacing={{ xs: 1, sm: 0 }}
                      sx={{
                        py: 2.5,
                        px: { xs: 2.5, sm: 3 },
                        justifyContent: 'space-between',
                        alignItems: { xs: 'flex-start', sm: 'center' },
                        gap: 1.5,
                      }}
                    >
                      <Typography variant="caption" sx={{ color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', flexShrink: 0, minWidth: { sm: 100 } }}>
                        File
                      </Typography>
                      <Typography
                        variant="body1"
                        sx={{
                          fontWeight: 600,
                          color: 'var(--text-main)',
                          textAlign: { xs: 'left', sm: 'right' },
                          wordBreak: 'break-word',
                          flex: 1,
                          lineHeight: 1.6,
                        }}
                      >
                        {file?.name || '—'}
                      </Typography>
                    </Stack>
                    <Divider sx={{ borderColor: 'var(--surface-divider)' }} />
                    <Box sx={{ py: 2.5, px: { xs: 2.5, sm: 3 } }}>
                      <Typography variant="caption" sx={{ color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', display: 'block', mb: 1.5 }}>
                        To
                      </Typography>
                      {mapping.name && mapping.email ? (
                        <Stack spacing={1}>
                          <Typography variant="body1" sx={{ fontWeight: 700, color: 'var(--text-main)', lineHeight: 1.5 }}>
                            {String(sampleData[0]?.[mapping.name] ?? '').trim() || '—'}
                          </Typography>
                          <Typography
                            component="div"
                            variant="body2"
                            sx={{
                              color: 'var(--text-muted)',
                              fontWeight: 500,
                              lineHeight: 1.75,
                              wordBreak: 'break-word',
                              overflowWrap: 'anywhere',
                              maxWidth: '100%',
                            }}
                          >
                            {String(sampleData[0]?.[mapping.email] ?? '').trim() || '—'}
                          </Typography>
                        </Stack>
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          —
                        </Typography>
                      )}
                    </Box>
                    {mapping.amount && (
                      <>
                        <Divider sx={{ borderColor: 'var(--surface-divider)' }} />
                        <Stack
                          direction={{ xs: 'column', sm: 'row' }}
                          spacing={{ xs: 1, sm: 0 }}
                          sx={{
                            py: 2.5,
                            px: { xs: 2.5, sm: 3 },
                            justifyContent: 'space-between',
                            alignItems: { xs: 'flex-start', sm: 'center' },
                            gap: 1.5,
                          }}
                        >
                          <Typography variant="caption" sx={{ color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', flexShrink: 0, minWidth: { sm: 100 } }}>
                            Amount
                          </Typography>
                          <Typography variant="body1" sx={{ fontWeight: 600, color: 'var(--text-main)', textAlign: { xs: 'left', sm: 'right' }, flex: 1 }}>
                            ₹ {sampleData[0]?.[mapping.amount] ?? '—'}
                          </Typography>
                        </Stack>
                      </>
                    )}
                    <Divider sx={{ borderColor: 'var(--surface-divider)' }} />
                    <Stack
                      direction="row"
                      alignItems="center"
                      justifyContent="space-between"
                      sx={{ py: 2.5, px: { xs: 2.5, sm: 3 }, bgcolor: 'rgba(22, 102, 211, 0.04)' }}
                    >
                      <Typography variant="caption" sx={{ color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                        Recipients
                      </Typography>
                        <Chip
                          size="medium"
                          label={`${totalRecipientCount} ${totalRecipientCount === 1 ? 'EMAIL' : 'EMAILS'}`}
                          sx={{
                            fontWeight: 800,
                            bgcolor: 'rgba(22, 102, 211, 0.12)',
                            color: 'var(--primary)',
                            border: 'none',
                          }}
                        />
                    </Stack>
                  </Box>
                </Grid>

                <Grid item xs={12} md={5}>
                  <Stack spacing={3}>
                    <Box>
                      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
                        <ScheduleIcon sx={{ fontSize: 22, color: 'var(--text-muted)' }} />
                        <Typography variant="subtitle1" sx={{ fontWeight: 800, color: 'var(--text-main)' }}>
                          Schedule (optional)
                        </Typography>
                      </Stack>
                      <TextField
                        fullWidth
                        type="datetime-local"
                        label="Send at"
                        InputLabelProps={{ shrink: true }}
                        inputProps={{ min: toLocalDateTimeInput(new Date()) }}
                        value={scheduledFor}
                        onChange={(e) => setScheduledFor(e.target.value)}
                        sx={{ mb: 2.5 }}
                      />
                      <Stack direction="row" flexWrap="wrap" sx={{ gap: 1.25 }}>
                        <Button size="medium" variant={!scheduledFor ? 'contained' : 'outlined'} onClick={() => applySchedulePreset('now')}>
                          Now
                        </Button>
                        <Button size="medium" variant="outlined" onClick={() => applySchedulePreset('in1h')}>
                          In 1 hour
                        </Button>
                        <Button size="medium" variant="outlined" onClick={() => applySchedulePreset('tomorrow9')}>
                          Tomorrow 9 AM
                        </Button>
                        <Button size="medium" variant="outlined" onClick={() => applySchedulePreset('nextMonday9')}>
                          Next Monday 9 AM
                        </Button>
                      </Stack>
                    </Box>

                    <Box>
                      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
                        <AttachFileIcon sx={{ fontSize: 20, color: 'var(--text-muted)' }} />
                        <Typography variant="subtitle1" sx={{ fontWeight: 800, color: 'var(--text-main)' }}>
                          Attachments (optional)
                        </Typography>
                      </Stack>
                      <Button
                        component="label"
                        variant="outlined"
                        size="small"
                        disabled={!batchId || attachmentUploading}
                        sx={{ mb: 1.25 }}
                      >
                        {attachmentUploading ? 'Uploading...' : 'Add attachment'}
                        <input
                          hidden
                          type="file"
                          onChange={(e) => uploadAttachment(e.target.files?.[0])}
                        />
                      </Button>
                      <Typography variant="caption" sx={{ display: 'block', color: 'var(--text-muted)', mb: 1.25 }}>
                        Allowed: {ALLOWED_ATTACHMENT_EXT.join(', ')} | Max 10 MB each
                      </Typography>
                      <Stack spacing={1}>
                        {attachments.map((att) => (
                          <Paper
                            key={att.id}
                            variant="outlined"
                            sx={{ p: 1.2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderColor: 'var(--surface-divider)' }}
                          >
                            <Box sx={{ minWidth: 0 }}>
                              <Typography variant="body2" sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {att.original_filename}
                              </Typography>
                              <Typography variant="caption" sx={{ color: 'var(--text-muted)' }}>
                                {(att.file_size / 1024 / 1024).toFixed(2)} MB
                              </Typography>
                            </Box>
                            <IconButton size="small" color="error" onClick={() => removeAttachment(att.id)}>
                              <DeleteOutlineIcon fontSize="small" />
                            </IconButton>
                          </Paper>
                        ))}
                        {attachments.length === 0 && (
                          <Typography variant="caption" sx={{ color: 'var(--text-muted)' }}>
                            No attachments added for this batch.
                          </Typography>
                        )}
                      </Stack>
                    </Box>

                    <Stack spacing={2} sx={{ pt: { xs: 0, md: 1 } }}>
                      <Button
                        fullWidth
                        variant="contained"
                        className="btn-studio"
                        size="large"
                        startIcon={<SendIcon />}
                        onClick={handleLaunch}
                        disabled={loading || sampleData.length === 0 || !batchId}
                        sx={{
                          py: 1.75,
                          fontSize: '1.05rem',
                          fontWeight: 700,
                          borderRadius: 2,
                          boxShadow: '0 8px 24px rgba(22, 102, 211, 0.22)',
                        }}
                      >
                        {totalRecipientCount > 0
                          ? `Launch Outreach (${totalRecipientCount} ${totalRecipientCount === 1 ? 'Email' : 'Emails'})`
                          : 'No rows to send'}
                      </Button>
                      <Button
                        fullWidth
                        variant="text"
                        onClick={() => setActiveStep(2)}
                        sx={{ fontWeight: 600, color: 'var(--text-muted)', py: 1 }}
                      >
                        ← Back to edit email
                      </Button>
                    </Stack>
                  </Stack>
                </Grid>
              </Grid>
            </Paper>
          </Box>
        </Fade>
      )}

      {/* Persistence Floor Controls */}
      <Box sx={{ mt: 2, pt: 1, borderTop: '1px solid var(--surface-divider)' }}>
        {activeStep === 2 ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5 }}>
            <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Button 
                startIcon={<ArrowBack />} 
                onClick={() => { setActiveStep(activeStep - 1); }} 
                sx={{ fontWeight: 600, color: 'var(--text-muted)' }}
              >
                Back
              </Button>
              <Button
                variant="contained"
                className="btn-studio"
                onClick={() => setActiveStep(3)}
                disabled={!batchId || !template.subject || (template.is_html ? !template.html : !rawUserBody)}
                sx={{ px: 5, py: 1.4, borderRadius: 999, minWidth: 220 }}
              >
                Go to Send Page
              </Button>
            </Box>
            <Typography variant="caption" sx={{ fontWeight: 500, color: 'var(--text-muted)', opacity: 0.6 }}>
              STEP 3 OF 4 · PRECISION OUTREACH
            </Typography>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Box>
              {activeStep > 0 && (
                <Button 
                  startIcon={<ArrowBack />} 
                  onClick={() => { setActiveStep(activeStep - 1); }} 
                  sx={{ fontWeight: 600, color: 'var(--text-muted)' }}
                >
                  Back
                </Button>
              )}
            </Box>
            <Typography variant="caption" sx={{ alignSelf: 'center', fontWeight: 500, color: 'var(--text-muted)', opacity: 0.5 }}>
              STEP {activeStep + 1} OF 4 · PRECISION OUTREACH
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}
