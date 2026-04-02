import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import {
  Box,
  Container,
  Typography,
  TextField,
  Button,
  Tabs,
  Tab,
  Divider,
  Alert,
  CircularProgress,
  Paper,
  InputAdornment,
  IconButton,
  LinearProgress,
  Link,
  Chip,
  Tooltip,
} from '@mui/material';
import {
  Email as EmailIcon,
  Lock as LockIcon,
  Visibility,
  VisibilityOff,
  Person as PersonIcon,
  CheckCircle as CheckCircleIcon,
  ArrowBack as ArrowBackIcon,
  MarkEmailRead as MarkEmailReadIcon,
  LockReset as LockResetIcon,
} from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';

// ─── Password strength ────────────────────────────────────────────────────────

function getPasswordStrength(pw: string) {
  if (!pw) return { score: 0, label: '', color: '#e2e8f0' };
  let pts = 0;
  if (pw.length >= 8) pts++;
  if (pw.length >= 12) pts++;
  if (/[A-Z]/.test(pw)) pts++;
  if (/[0-9]/.test(pw)) pts++;
  if (/[^A-Za-z0-9]/.test(pw)) pts++;
  const map: Record<number, { score: number; label: string; color: string }> = {
    0: { score: 5,  label: 'Too short',   color: '#ef4444' },
    1: { score: 20, label: 'Weak',         color: '#ef4444' },
    2: { score: 40, label: 'Fair',         color: '#f97316' },
    3: { score: 60, label: 'Good',         color: '#eab308' },
    4: { score: 80, label: 'Strong',       color: '#22c55e' },
    5: { score: 100, label: 'Very strong', color: '#16a34a' },
  };
  return map[pts] ?? map[5];
}

// ─── Google Sign-In button ─────────────────────────────────────────────────────
// Renders the official GSI button when a clientId is available; gracefully
// falls back to a disabled placeholder with an admin hint otherwise.

interface GoogleBtnProps {
  clientId: string | null;
  onSuccess: (credential: string) => void;
  isLoading: boolean;
  label?: string;
}

const GoogleSignInButton: React.FC<GoogleBtnProps> = ({
  clientId,
  onSuccess,
  isLoading,
  label = 'Continue with Google',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const callbackRef = useRef(onSuccess);
  const [ready, setReady] = useState(false);
  callbackRef.current = onSuccess;

  useEffect(() => {
    if (!clientId || !containerRef.current) return;

    const init = () => {
      const g = (window as any).google?.accounts?.id;
      if (!g) return;
      g.initialize({
        client_id: clientId,
        callback: (resp: any) => callbackRef.current(resp.credential),
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      g.renderButton(containerRef.current, {
        theme: 'outline',
        size: 'large',
        width: containerRef.current?.offsetWidth ?? 320,
        text: 'continue_with',
        shape: 'rectangular',
      });
      setReady(true);
    };

    if ((window as any).google?.accounts?.id) {
      init();
      return;
    }

    const existing = document.getElementById('gsi-script');
    if (!existing) {
      const script = document.createElement('script');
      script.id = 'gsi-script';
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = init;
      document.head.appendChild(script);
    } else {
      existing.addEventListener('load', init);
    }
  }, [clientId]);

  // Rebuild button width when container width changes (e.g. after paper renders)
  useEffect(() => {
    if (!ready || !clientId || !containerRef.current) return;
    const g = (window as any).google?.accounts?.id;
    if (!g) return;
    g.renderButton(containerRef.current, {
      theme: 'outline',
      size: 'large',
      width: containerRef.current.offsetWidth,
      text: 'continue_with',
      shape: 'rectangular',
    });
  }, [ready, clientId]);

  if (!clientId) {
    return (
      <Tooltip title="Google Sign-In is not configured. Ask your admin to set GOOGLE_CLIENT_ID." arrow>
        <span style={{ width: '100%' }}>
          <Button
            fullWidth
            variant="outlined"
            size="large"
            disabled
            startIcon={
              <Box
                component="img"
                src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
                sx={{ width: 18, height: 18 }}
              />
            }
            sx={{
              borderRadius: 2.5,
              py: 1.3,
              fontWeight: 600,
              textTransform: 'none',
              fontSize: '0.95rem',
            }}
          >
            {label}
          </Button>
        </span>
      </Tooltip>
    );
  }

  return (
    <Box
      sx={{
        opacity: isLoading ? 0.5 : 1,
        pointerEvents: isLoading ? 'none' : 'auto',
        transition: 'opacity 0.2s',
        '& > div': { width: '100% !important' },
        '& iframe': { width: '100% !important' },
        minHeight: 44,
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <div ref={containerRef} style={{ width: '100%' }} />
      {!ready && (
        <Box sx={{ width: '100%', textAlign: 'center', py: 1 }}>
          <CircularProgress size={18} sx={{ color: '#94a3b8' }} />
        </Box>
      )}
    </Box>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

type View = 'signin' | 'signup' | 'forgot' | 'reset';

interface FormState {
  email: string;
  password: string;
  confirmPassword: string;
  showPassword: boolean;
  showConfirm: boolean;
  newPassword: string;
  showNew: boolean;
}

const INITIAL_FORM: FormState = {
  email: '',
  password: '',
  confirmPassword: '',
  showPassword: false,
  showConfirm: false,
  newPassword: '',
  showNew: false,
};

const inputSx = { '& .MuiOutlinedInput-root': { borderRadius: 2.5 } };

const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as any)?.from?.pathname || '/';

  // Detect reset_token in URL
  const searchParams = new URLSearchParams(location.search);
  const urlResetToken = searchParams.get('reset_token') ?? '';

  const [view, setView] = useState<View>(urlResetToken ? 'reset' : 'signin');
  const [tab, setTab] = useState(0); // 0 = sign in, 1 = sign up (used only in signin/signup views)
  const [form, setForm] = useState<FormState>({ ...INITIAL_FORM });
  const [resetToken, setResetToken] = useState(urlResetToken);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [googleClientId, setGoogleClientId] = useState<string | null>(
    (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID ?? null
  );

  // Fetch runtime config (fallback for pre-built bundles without baked-in env)
  useEffect(() => {
    if (!googleClientId) {
      axios.get('/api/config').then(res => {
        if (res.data?.google_client_id) setGoogleClientId(res.data.google_client_id);
      }).catch(() => {});
    }
  }, [googleClientId]);

  const clearMessages = () => { setError(''); setSuccess(''); };

  const field = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm(prev => ({ ...prev, [key]: e.target.value }));
    clearMessages();
  };

  const toggle = (key: 'showPassword' | 'showConfirm' | 'showNew') =>
    setForm(prev => ({ ...prev, [key]: !prev[key] }));

  const switchView = (v: View) => {
    setView(v);
    clearMessages();
    setForm(prev => ({ ...prev, password: '', confirmPassword: '', newPassword: '' }));
  };

  // ── Sign In ─────────────────────────────────────────────────────────────────
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.email.trim()) { setError('Please enter your email.'); return; }
    setIsLoading(true);
    clearMessages();
    try {
      const res = await axios.post('/api/auth/login', { email: form.email.trim(), password: form.password });
      login(res.data.access_token, res.data.user);
      navigate(from, { replace: true });
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      setError(
        typeof detail === 'object' ? detail.message : detail ?? 'Invalid credentials. Please try again.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  // ── Sign Up ─────────────────────────────────────────────────────────────────
  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.email.trim()) { setError('Please enter your email.'); return; }
    if (form.password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (form.password !== form.confirmPassword) { setError('Passwords do not match.'); return; }
    setIsLoading(true);
    clearMessages();
    try {
      await axios.post('/api/auth/signup', { email: form.email.trim(), password: form.password });
      setSuccess('Account request submitted! You will gain access once an admin approves your account.');
      setTab(0);
      setView('signin');
      setForm({ ...INITIAL_FORM, email: form.email });
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      setError(
        typeof detail === 'object' ? detail.message : detail ?? 'Could not create account. Please try again.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  // ── Google ──────────────────────────────────────────────────────────────────
  const handleGoogleCredential = useCallback(async (credential: string) => {
    setIsLoading(true);
    clearMessages();
    try {
      const res = await axios.post('/api/auth/google', { credential });
      if (!res.data.user.is_approved) {
        setSuccess('Google account registered! Waiting for admin approval before you can sign in.');
        return;
      }
      login(res.data.access_token, res.data.user);
      navigate(from, { replace: true });
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      setError(
        typeof detail === 'object' ? detail.message : detail ?? 'Google sign-in failed. Please try again.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [from, login, navigate]);

  // ── Forgot Password ─────────────────────────────────────────────────────────
  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.email.trim()) { setError('Please enter your email.'); return; }
    setIsLoading(true);
    clearMessages();
    try {
      await axios.post('/api/auth/forgot-password', { email: form.email.trim() });
      setSuccess(
        'If that email is registered, a password-reset link has been sent. Check your inbox (and spam folder).'
      );
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // ── Reset Password ──────────────────────────────────────────────────────────
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.newPassword.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (form.newPassword !== form.confirmPassword) { setError('Passwords do not match.'); return; }
    setIsLoading(true);
    clearMessages();
    try {
      await axios.post('/api/auth/reset-password', {
        token: resetToken,
        new_password: form.newPassword,
      });
      setSuccess('Password updated! You can now sign in with your new password.');
      // Clean reset token from URL
      navigate('/auth', { replace: true });
      setResetToken('');
      setTimeout(() => switchView('signin'), 2000);
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'Reset link is invalid or has expired.');
    } finally {
      setIsLoading(false);
    }
  };

  // ── Shared field helpers ────────────────────────────────────────────────────
  const pwStrength = getPasswordStrength(
    view === 'reset' ? form.newPassword : form.password
  );

  const PasswordField = ({
    id, label, value, onChange, showKey, autoFocus = false, helperText,
  }: {
    id: string; label: string; value: string;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    showKey: 'showPassword' | 'showConfirm' | 'showNew';
    autoFocus?: boolean; helperText?: string;
  }) => (
    <TextField
      id={id} label={label} fullWidth autoFocus={autoFocus}
      type={form[showKey] ? 'text' : 'password'}
      value={value} onChange={onChange}
      helperText={helperText}
      required
      InputProps={{
        startAdornment: (
          <InputAdornment position="start">
            <LockIcon sx={{ color: '#94a3b8', fontSize: 20 }} />
          </InputAdornment>
        ),
        endAdornment: (
          <InputAdornment position="end">
            <IconButton onClick={() => toggle(showKey)} edge="end" size="small">
              {form[showKey] ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
            </IconButton>
          </InputAdornment>
        ),
      }}
      sx={inputSx}
    />
  );

  // ── Shared button style ─────────────────────────────────────────────────────
  const primaryBtnSx = (gradient: string, shadow: string) => ({
    borderRadius: 2.5, py: 1.4, fontWeight: 700, fontSize: '1rem',
    textTransform: 'none' as const,
    background: gradient,
    boxShadow: shadow,
    '&:hover': { boxShadow: shadow.replace('0.32', '0.45'), transform: 'translateY(-1px)' },
    transition: 'all 0.2s ease',
  });

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <Box
      sx={{
        minHeight: '100vh',
        background: 'linear-gradient(145deg, #f0f4ff 0%, #fafafd 50%, #f0f8ff 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        py: 4,
      }}
    >
      <Container maxWidth="xs">
        {/* Branding */}
        <Box sx={{ textAlign: 'center', mb: 4 }}>
          <Box
            component="img"
            src="/ikf.png"
            alt="IKF Logo"
            sx={{ height: 48, width: 'auto', mb: 2, filter: 'drop-shadow(0 4px 12px rgba(22,102,211,0.18))' }}
          />
          <Typography variant="h5" fontWeight={800} sx={{ color: '#0f172a', letterSpacing: '-0.03em' }}>
            IKF MailMerge Studio
          </Typography>
          <Typography variant="body2" sx={{ color: '#64748b', mt: 0.5 }}>
            Enterprise email outreach platform
          </Typography>
        </Box>

        <Paper
          elevation={0}
          sx={{
            p: 4,
            borderRadius: 4,
            border: '1px solid rgba(226,232,240,0.8)',
            boxShadow: '0 8px 40px rgba(15,23,42,0.06)',
            backdropFilter: 'blur(12px)',
            bgcolor: 'rgba(255,255,255,0.97)',
          }}
        >
          {/* ── SIGN IN / SIGN UP ─────────────────────────── */}
          {(view === 'signin' || view === 'signup') && (
            <>
              <Tabs
                value={tab}
                onChange={(_, v) => { setTab(v); switchView(v === 0 ? 'signin' : 'signup'); }}
                variant="fullWidth"
                sx={{
                  mb: 3,
                  '& .MuiTab-root': { fontWeight: 700, textTransform: 'none', fontSize: '0.95rem' },
                  '& .MuiTabs-indicator': { height: 3, borderRadius: 2, bgcolor: '#1666d3' },
                }}
              >
                <Tab label="Sign In" />
                <Tab label="Request Access" />
              </Tabs>

              {error && <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>{error}</Alert>}
              {success && (
                <Alert severity="success" icon={<CheckCircleIcon />} sx={{ mb: 2, borderRadius: 2 }}>
                  {success}
                </Alert>
              )}

              {/* ── Sign-in form ── */}
              {view === 'signin' && (
                <Box component="form" onSubmit={handleLogin} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <TextField
                    id="login-email" label="Work Email" type="email"
                    value={form.email} onChange={field('email')}
                    required fullWidth autoFocus
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <EmailIcon sx={{ color: '#94a3b8', fontSize: 20 }} />
                        </InputAdornment>
                      ),
                    }}
                    sx={inputSx}
                  />
                  <Box>
                    <PasswordField
                      id="login-password" label="Password"
                      value={form.password} onChange={field('password')}
                      showKey="showPassword"
                    />
                    <Box sx={{ textAlign: 'right', mt: 0.5 }}>
                      <Link
                        component="button"
                        type="button"
                        variant="caption"
                        onClick={() => switchView('forgot')}
                        sx={{ color: '#1666d3', textDecoration: 'none', fontWeight: 600, '&:hover': { textDecoration: 'underline' } }}
                      >
                        Forgot password?
                      </Link>
                    </Box>
                  </Box>

                  <Button
                    id="login-submit" type="submit" variant="contained" size="large" fullWidth
                    disabled={isLoading}
                    sx={primaryBtnSx(
                      'linear-gradient(135deg, #1666d3 0%, #1e40af 100%)',
                      '0 4px 18px rgba(22,102,211,0.32)'
                    )}
                  >
                    {isLoading ? <CircularProgress size={22} color="inherit" /> : 'Sign In'}
                  </Button>

                  <Divider sx={{ my: 0.5 }}>
                    <Typography variant="caption" sx={{ color: '#94a3b8', px: 1 }}>or</Typography>
                  </Divider>

                  <GoogleSignInButton
                    clientId={googleClientId}
                    onSuccess={handleGoogleCredential}
                    isLoading={isLoading}
                    label="Sign in with Google"
                  />
                </Box>
              )}

              {/* ── Sign-up form ── */}
              {view === 'signup' && (
                <Box component="form" onSubmit={handleSignup} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <Alert severity="info" sx={{ borderRadius: 2, fontSize: '0.82rem' }}>
                    New accounts require <strong>admin approval</strong> before you can sign in.
                  </Alert>

                  <TextField
                    id="signup-email" label="Work Email" type="email"
                    value={form.email} onChange={field('email')}
                    required fullWidth autoFocus
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <PersonIcon sx={{ color: '#94a3b8', fontSize: 20 }} />
                        </InputAdornment>
                      ),
                    }}
                    sx={inputSx}
                  />

                  <Box>
                    <PasswordField
                      id="signup-password" label="Password"
                      value={form.password} onChange={field('password')}
                      showKey="showPassword"
                    />
                    {form.password && (
                      <Box sx={{ mt: 1, px: 0.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                          <LinearProgress
                            variant="determinate"
                            value={pwStrength.score}
                            sx={{
                              flex: 1, height: 5, borderRadius: 3,
                              bgcolor: '#f1f5f9',
                              '& .MuiLinearProgress-bar': { bgcolor: pwStrength.color, borderRadius: 3 },
                            }}
                          />
                          <Typography variant="caption" sx={{ color: pwStrength.color, fontWeight: 700, minWidth: 72 }}>
                            {pwStrength.label}
                          </Typography>
                        </Box>
                        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                          {[
                            { label: '8+ chars', ok: form.password.length >= 8 },
                            { label: 'Uppercase', ok: /[A-Z]/.test(form.password) },
                            { label: 'Number', ok: /[0-9]/.test(form.password) },
                            { label: 'Symbol', ok: /[^A-Za-z0-9]/.test(form.password) },
                          ].map(r => (
                            <Chip
                              key={r.label} label={r.label} size="small"
                              sx={{
                                fontSize: '0.7rem', height: 20,
                                bgcolor: r.ok ? '#dcfce7' : '#f1f5f9',
                                color: r.ok ? '#16a34a' : '#94a3b8',
                                fontWeight: r.ok ? 700 : 400,
                                border: 'none',
                              }}
                            />
                          ))}
                        </Box>
                      </Box>
                    )}
                  </Box>

                  <PasswordField
                    id="signup-confirm" label="Confirm Password"
                    value={form.confirmPassword} onChange={field('confirmPassword')}
                    showKey="showConfirm"
                    helperText={
                      form.confirmPassword && form.password !== form.confirmPassword
                        ? 'Passwords do not match'
                        : undefined
                    }
                  />

                  <Button
                    id="signup-submit" type="submit" variant="contained" size="large" fullWidth
                    disabled={isLoading || (!!form.confirmPassword && form.password !== form.confirmPassword)}
                    sx={primaryBtnSx(
                      'linear-gradient(135deg, #0f766e 0%, #0d9488 100%)',
                      '0 4px 18px rgba(13,148,136,0.32)'
                    )}
                  >
                    {isLoading ? <CircularProgress size={22} color="inherit" /> : 'Request Access'}
                  </Button>

                  <Divider sx={{ my: 0.5 }}>
                    <Typography variant="caption" sx={{ color: '#94a3b8', px: 1 }}>or</Typography>
                  </Divider>

                  <GoogleSignInButton
                    clientId={googleClientId}
                    onSuccess={handleGoogleCredential}
                    isLoading={isLoading}
                    label="Sign up with Google"
                  />
                </Box>
              )}
            </>
          )}

          {/* ── FORGOT PASSWORD ───────────────────────────── */}
          {view === 'forgot' && (
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
                <IconButton size="small" onClick={() => switchView('signin')} sx={{ color: '#64748b' }}>
                  <ArrowBackIcon fontSize="small" />
                </IconButton>
                <Typography variant="h6" fontWeight={700} sx={{ color: '#0f172a' }}>
                  Reset your password
                </Typography>
              </Box>

              {error && <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>{error}</Alert>}
              {success ? (
                <Box sx={{ textAlign: 'center', py: 2 }}>
                  <MarkEmailReadIcon sx={{ fontSize: 52, color: '#1666d3', mb: 1.5 }} />
                  <Alert severity="success" icon={false} sx={{ borderRadius: 2, textAlign: 'left' }}>
                    {success}
                  </Alert>
                  <Button
                    variant="text" size="small" sx={{ mt: 2, textTransform: 'none', color: '#64748b' }}
                    onClick={() => switchView('signin')}
                  >
                    Back to Sign In
                  </Button>
                </Box>
              ) : (
                <Box component="form" onSubmit={handleForgotPassword} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <Typography variant="body2" sx={{ color: '#64748b' }}>
                    Enter your work email and we'll send you a link to reset your password. The link expires in <strong>30 minutes</strong>.
                  </Typography>

                  <TextField
                    id="forgot-email" label="Work Email" type="email"
                    value={form.email} onChange={field('email')}
                    required fullWidth autoFocus
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <EmailIcon sx={{ color: '#94a3b8', fontSize: 20 }} />
                        </InputAdornment>
                      ),
                    }}
                    sx={inputSx}
                  />

                  <Button
                    type="submit" variant="contained" size="large" fullWidth
                    disabled={isLoading}
                    sx={primaryBtnSx(
                      'linear-gradient(135deg, #1666d3 0%, #1e40af 100%)',
                      '0 4px 18px rgba(22,102,211,0.32)'
                    )}
                  >
                    {isLoading ? <CircularProgress size={22} color="inherit" /> : 'Send Reset Link'}
                  </Button>

                  <Box sx={{ textAlign: 'center' }}>
                    <Link
                      component="button" type="button" variant="body2"
                      onClick={() => switchView('signin')}
                      sx={{ color: '#64748b', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
                    >
                      Back to Sign In
                    </Link>
                  </Box>
                </Box>
              )}
            </Box>
          )}

          {/* ── RESET PASSWORD ────────────────────────────── */}
          {view === 'reset' && (
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
                <LockResetIcon sx={{ color: '#1666d3', fontSize: 26 }} />
                <Typography variant="h6" fontWeight={700} sx={{ color: '#0f172a' }}>
                  Choose a new password
                </Typography>
              </Box>

              {error && <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>{error}</Alert>}
              {success ? (
                <Box sx={{ textAlign: 'center', py: 2 }}>
                  <CheckCircleIcon sx={{ fontSize: 52, color: '#22c55e', mb: 1.5 }} />
                  <Alert severity="success" icon={false} sx={{ borderRadius: 2, textAlign: 'left' }}>
                    {success}
                  </Alert>
                </Box>
              ) : (
                <Box component="form" onSubmit={handleResetPassword} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <Box>
                    <PasswordField
                      id="reset-new" label="New Password" autoFocus
                      value={form.newPassword} onChange={field('newPassword')}
                      showKey="showNew"
                    />
                    {form.newPassword && (
                      <Box sx={{ mt: 1, px: 0.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                          <LinearProgress
                            variant="determinate"
                            value={pwStrength.score}
                            sx={{
                              flex: 1, height: 5, borderRadius: 3,
                              bgcolor: '#f1f5f9',
                              '& .MuiLinearProgress-bar': { bgcolor: pwStrength.color, borderRadius: 3 },
                            }}
                          />
                          <Typography variant="caption" sx={{ color: pwStrength.color, fontWeight: 700, minWidth: 72 }}>
                            {pwStrength.label}
                          </Typography>
                        </Box>
                        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                          {[
                            { label: '8+ chars', ok: form.newPassword.length >= 8 },
                            { label: 'Uppercase', ok: /[A-Z]/.test(form.newPassword) },
                            { label: 'Number', ok: /[0-9]/.test(form.newPassword) },
                            { label: 'Symbol', ok: /[^A-Za-z0-9]/.test(form.newPassword) },
                          ].map(r => (
                            <Chip
                              key={r.label} label={r.label} size="small"
                              sx={{
                                fontSize: '0.7rem', height: 20,
                                bgcolor: r.ok ? '#dcfce7' : '#f1f5f9',
                                color: r.ok ? '#16a34a' : '#94a3b8',
                                fontWeight: r.ok ? 700 : 400,
                              }}
                            />
                          ))}
                        </Box>
                      </Box>
                    )}
                  </Box>

                  <PasswordField
                    id="reset-confirm" label="Confirm New Password"
                    value={form.confirmPassword} onChange={field('confirmPassword')}
                    showKey="showConfirm"
                    helperText={
                      form.confirmPassword && form.newPassword !== form.confirmPassword
                        ? 'Passwords do not match'
                        : undefined
                    }
                  />

                  <Button
                    type="submit" variant="contained" size="large" fullWidth
                    disabled={
                      isLoading ||
                      form.newPassword.length < 8 ||
                      (!!form.confirmPassword && form.newPassword !== form.confirmPassword)
                    }
                    sx={primaryBtnSx(
                      'linear-gradient(135deg, #1666d3 0%, #1e40af 100%)',
                      '0 4px 18px rgba(22,102,211,0.32)'
                    )}
                  >
                    {isLoading ? <CircularProgress size={22} color="inherit" /> : 'Set New Password'}
                  </Button>
                </Box>
              )}
            </Box>
          )}

          <Divider sx={{ mt: 3, mb: 2 }} />
          <Typography variant="caption" display="block" textAlign="center" sx={{ color: '#94a3b8' }}>
            IKF — I Knowledge Factory Pvt. Ltd. · Internal Platform
          </Typography>
        </Paper>
      </Container>
    </Box>
  );
};

export default LoginPage;
