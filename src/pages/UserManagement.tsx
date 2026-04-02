import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Button,
  CircularProgress,
  Alert,
  Tooltip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from '@mui/material';
import {
  CheckCircle as ApproveIcon,
  Block as RevokeIcon,
  Delete as DeleteIcon,
  AdminPanelSettings as AdminIcon,
  Person as UserIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';

interface User {
  id: number;
  email: string;
  role: string;
  is_approved: boolean;
  created_at: string;
}

const UserManagement: React.FC = () => {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; userId: number | null; action: string }>({
    open: false,
    userId: null,
    action: '',
  });

  const fetchUsers = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const res = await axios.get('/api/admin/users');
      setUsers(res.data);
    } catch (err: any) {
      setError('Failed to load users. Make sure you are an admin.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleApprove = async (userId: number) => {
    try {
      await axios.post(`/api/admin/users/${userId}/approve`);
      setSuccess('User approved successfully.');
      fetchUsers();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to approve user.');
    }
  };

  const handleRevoke = async (userId: number) => {
    try {
      await axios.post(`/api/admin/users/${userId}/revoke`);
      setSuccess('User access revoked.');
      fetchUsers();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to revoke user.');
    }
  };

  const handlePromote = async (userId: number) => {
    try {
      await axios.post(`/api/admin/users/${userId}/promote`);
      setSuccess('User promoted to admin.');
      fetchUsers();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to promote user.');
    }
  };

  const handleDemote = async (userId: number) => {
    try {
      await axios.post(`/api/admin/users/${userId}/demote`);
      setSuccess('Admin downgraded to regular user.');
      fetchUsers();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to demote user.');
    }
  };

  const handleDelete = async (userId: number) => {
    try {
      await axios.delete(`/api/admin/users/${userId}`);
      setSuccess('User deleted.');
      setConfirmDialog({ open: false, userId: null, action: '' });
      fetchUsers();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to delete user.');
    }
  };

  const pendingCount = users.filter(u => !u.is_approved).length;

  return (
    <Box sx={{ py: 4 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h5" fontWeight={800} sx={{ color: '#0f172a', letterSpacing: '-0.03em' }}>
            User Management
          </Typography>
          <Typography variant="body2" sx={{ color: '#64748b', mt: 0.5 }}>
            Approve, revoke, or promote users across the platform.
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {pendingCount > 0 && (
            <Chip
              label={`${pendingCount} Pending Approval`}
              color="warning"
              size="small"
              sx={{ fontWeight: 700 }}
            />
          )}
          <Tooltip title="Refresh">
            <IconButton onClick={fetchUsers} size="small">
              <RefreshIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2, borderRadius: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Paper elevation={0} sx={{ border: '1px solid #e2e8f0', borderRadius: 3, overflow: 'hidden' }}>
          <TableContainer>
            <Table>
              <TableHead sx={{ bgcolor: '#f8fafc' }}>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700, color: '#475569' }}>Email</TableCell>
                  <TableCell sx={{ fontWeight: 700, color: '#475569' }}>Role</TableCell>
                  <TableCell sx={{ fontWeight: 700, color: '#475569' }}>Status</TableCell>
                  <TableCell sx={{ fontWeight: 700, color: '#475569' }}>Joined</TableCell>
                  <TableCell sx={{ fontWeight: 700, color: '#475569' }} align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {users.map(user => (
                  <TableRow
                    key={user.id}
                    sx={{
                      '&:last-child td': { border: 0 },
                      bgcolor: !user.is_approved ? 'rgba(251, 191, 36, 0.05)' : 'transparent',
                      transition: 'background 0.2s',
                      '&:hover': { bgcolor: '#f8fafc' },
                    }}
                  >
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {user.role === 'admin'
                          ? <AdminIcon sx={{ fontSize: 18, color: '#1666d3' }} />
                          : <UserIcon sx={{ fontSize: 18, color: '#94a3b8' }} />}
                        <Typography variant="body2" fontWeight={600}>{user.email}</Typography>
                        {user.id === currentUser?.id && (
                          <Chip label="You" size="small" sx={{ height: 18, fontSize: '0.65rem', bgcolor: '#eff6ff', color: '#1666d3', fontWeight: 700 }} />
                        )}
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={user.role}
                        size="small"
                        sx={{
                          fontWeight: 700,
                          bgcolor: user.role === 'admin' ? '#eff6ff' : '#f1f5f9',
                          color: user.role === 'admin' ? '#1666d3' : '#475569',
                          textTransform: 'capitalize',
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={user.is_approved ? 'Approved' : 'Pending'}
                        size="small"
                        sx={{
                          fontWeight: 700,
                          bgcolor: user.is_approved ? '#f0fdf4' : '#fffbeb',
                          color: user.is_approved ? '#16a34a' : '#d97706',
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" sx={{ color: '#94a3b8' }}>
                        {new Date(user.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                        {!user.is_approved && (
                          <Tooltip title="Approve Access">
                            <Button
                              size="small"
                              variant="contained"
                              startIcon={<ApproveIcon />}
                              onClick={() => handleApprove(user.id)}
                              disabled={user.id === currentUser?.id}
                              sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 700, fontSize: '0.78rem', bgcolor: '#16a34a', '&:hover': { bgcolor: '#15803d' } }}
                            >
                              Approve
                            </Button>
                          </Tooltip>
                        )}
                        {user.is_approved && user.id !== currentUser?.id && (
                          <Tooltip title="Revoke Access">
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={<RevokeIcon />}
                              onClick={() => handleRevoke(user.id)}
                              sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 700, fontSize: '0.78rem', borderColor: '#fca5a5', color: '#dc2626', '&:hover': { bgcolor: '#fef2f2', borderColor: '#dc2626' } }}
                            >
                              Revoke
                            </Button>
                          </Tooltip>
                        )}
                        {user.role !== 'admin' && user.id !== currentUser?.id && (
                          <Tooltip title="Promote to Admin">
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={<AdminIcon />}
                              onClick={() => handlePromote(user.id)}
                              sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 700, fontSize: '0.78rem', borderColor: '#bfdbfe', color: '#1666d3', '&:hover': { bgcolor: '#eff6ff', borderColor: '#1666d3' } }}
                            >
                              Promote
                            </Button>
                          </Tooltip>
                        )}
                        {user.role === 'admin' && user.id !== currentUser?.id && (
                          <Tooltip title="Remove Admin">
                            <Button
                              size="small"
                              variant="outlined"
                              onClick={() => handleDemote(user.id)}
                              sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 700, fontSize: '0.78rem' }}
                            >
                              Demote
                            </Button>
                          </Tooltip>
                        )}
                        {user.id !== currentUser?.id && (
                          <Tooltip title="Delete User">
                            <IconButton
                              size="small"
                              onClick={() => setConfirmDialog({ open: true, userId: user.id, action: 'delete' })}
                              sx={{ color: '#dc2626', '&:hover': { bgcolor: '#fef2f2' } }}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                      </Box>
                    </TableCell>
                  </TableRow>
                ))}
                {users.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} sx={{ textAlign: 'center', py: 6, color: '#94a3b8' }}>
                      No users found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* Confirm Delete Dialog */}
      <Dialog open={confirmDialog.open} onClose={() => setConfirmDialog({ open: false, userId: null, action: '' })}>
        <DialogTitle sx={{ fontWeight: 800 }}>Delete User?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This action is permanent. All user data will be disassociated. Are you sure you want to delete this account?
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ p: 2, gap: 1 }}>
          <Button onClick={() => setConfirmDialog({ open: false, userId: null, action: '' })} sx={{ textTransform: 'none', fontWeight: 600 }}>
            Cancel
          </Button>
          <Button
            onClick={() => confirmDialog.userId && handleDelete(confirmDialog.userId)}
            variant="contained"
            color="error"
            sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 2 }}
          >
            Delete Permanently
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default UserManagement;
