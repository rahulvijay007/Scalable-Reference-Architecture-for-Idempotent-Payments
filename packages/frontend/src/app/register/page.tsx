'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Box, Button, Paper, TextField, Typography, Alert, Stack } from '@mui/material';
import { RegisterSchema } from '@payment-platform/shared';
import { useRegister } from '@/hooks/useAuth';
import { ApiClientError } from '@/lib/api-client';

export default function RegisterPage() {
  const router = useRouter();
  const register = useRegister();
  const [form, setForm] = useState({ email: '', password: '', firstName: '', lastName: '' });
  const [validationError, setValidationError] = useState<string | null>(null);

  const update = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    const parsed = RegisterSchema.safeParse(form);
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message || 'Invalid input');
      return;
    }

    register.mutate(parsed.data, {
      onSuccess: () => router.push('/payments'),
    });
  };

  const errorMessage =
    validationError ||
    (register.error instanceof ApiClientError ? register.error.message : register.error ? 'Registration failed' : null);

  return (
    <Box display="flex" minHeight="100vh" alignItems="center" justifyContent="center" bgcolor="background.default">
      <Paper elevation={0} variant="outlined" sx={{ p: 4, width: 420 }}>
        <Typography variant="h5" fontWeight={700} gutterBottom>
          Create an account
        </Typography>
        <Typography variant="body2" color="text.secondary" mb={3}>
          Payment Platform Dashboard
        </Typography>

        <form onSubmit={handleSubmit}>
          <Stack spacing={2}>
            {errorMessage && <Alert severity="error">{errorMessage}</Alert>}

            <Stack direction="row" spacing={2}>
              <TextField label="First name" value={form.firstName} onChange={update('firstName')} fullWidth required />
              <TextField label="Last name" value={form.lastName} onChange={update('lastName')} fullWidth required />
            </Stack>
            <TextField label="Email" type="email" value={form.email} onChange={update('email')} fullWidth required />
            <TextField
              label="Password"
              type="password"
              value={form.password}
              onChange={update('password')}
              helperText="At least 8 characters"
              fullWidth
              required
            />
            <Button type="submit" variant="contained" size="large" disabled={register.isPending} fullWidth>
              {register.isPending ? 'Creating account…' : 'Create account'}
            </Button>
          </Stack>
        </form>

        <Typography variant="body2" color="text.secondary" mt={3} textAlign="center">
          Already have an account? <Link href="/login">Sign in</Link>
        </Typography>
      </Paper>
    </Box>
  );
}
