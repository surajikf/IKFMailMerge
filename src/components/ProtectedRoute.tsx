import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Box, CircularProgress, Typography, Container, Paper } from '@mui/material';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, requireAdmin = false }) => {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', flexDirection: 'column', gap: 2 }}>
        <CircularProgress size={60} thickness={4} />
        <Typography variant="body1" color="text.secondary">Authenticating...</Typography>
      </Box>
    );
  }

  if (!user) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  if (requireAdmin && user.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  if (!user.is_approved) {
    return (
      <Container maxWidth="sm" sx={{ mt: 10 }}>
        <Paper elevation={0} sx={{ p: 5, textAlign: 'center', borderRadius: 4, border: '1px solid #e2e8f0', bgcolor: '#f8fafc' }}>
          <Typography variant="h4" gutterBottom sx={{ fontWeight: 800, color: '#1e293b' }}>
            Account Pending Approval
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
            Your account has been created successfully but requires administrator approval before you can access the platform features.
          </Typography>
          <Typography variant="body2" sx={{ fontStyle: 'italic' }}>
            Please contact suraj.sonnar@ikf.co.in if you need urgent access.
          </Typography>
        </Paper>
      </Container>
    );
  }

  return <>{children}</>;
};

export default ProtectedRoute;
