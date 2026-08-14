'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Box, Button, Paper, TextField, Typography, Alert, Stack } from '@mui/material';
import { LoginSchema } from '@payment-platform/shared';
import { useLogin } from '@/hooks/useAuth';
import { ApiClientError } from '@/lib/api-client';

export default function LoginPage() {
  const router = useRouter();
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    const parsed = LoginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message || 'Invalid input');
      return;
    }

    login.mutate(parsed.data, {
      onSuccess: () => router.push('/payments'),
    });
  };

  const errorMessage =
    validationError ||
    (login.error instanceof ApiClientError ? login.error.message : login.error ? 'Login failed' : null);

  return (
    <Box display="flex" minHeight="100vh" alignItems="center" justifyContent="center" bgcolor="background.default">
      <Paper elevation={0} variant="outlined" sx={{ p: 4, width: 380 }}>
        <Typography variant="h5" fontWeight={700} gutterBottom>
          Sign in
        </Typography>
        <Typography variant="body2" color="text.secondary" mb={3}>
          Payment Platform Dashboard
        </Typography>

        <form onSubmit={handleSubmit}>
          <Stack spacing={2}>
            {errorMessage && <Alert severity="error">{errorMessage}</Alert>}

            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              fullWidth
              required
            />
            <TextField
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              fullWidth
              required
            />
            <Button type="submit" variant="contained" size="large" disabled={login.isPending} fullWidth>
              {login.isPending ? 'Signing in…' : 'Sign in'}
            </Button>
          </Stack>
        </form>

        <Typography variant="body2" color="text.secondary" mt={3} textAlign="center">
          Don&apos;t have an account? <Link href="/register">Register</Link>
        </Typography>
      </Paper>
    </Box>
  );
}
