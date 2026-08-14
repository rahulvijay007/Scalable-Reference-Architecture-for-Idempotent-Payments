'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  Box,
  Paper,
  Typography,
  TextField,
  MenuItem,
  Button,
  Stack,
  Alert,
  Grid,
} from '@mui/material';
import { CreatePaymentSchema, Currency, PaymentMethod } from '@payment-platform/shared';
import { useCreatePayment } from '@/hooks/usePayments';
import { useAuthStore } from '@/lib/auth-store';
import { ApiClientError } from '@/lib/api-client';

export default function NewPaymentPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const createPayment = useCreatePayment();
  const [validationError, setValidationError] = useState<string | null>(null);

  const [form, setForm] = useState({
    amount: '',
    currency: Currency.USD,
    paymentMethod: PaymentMethod.CREDIT_CARD,
    cardNumber: '',
    expiryMonth: '',
    expiryYear: '',
    cvv: '',
    cardholderName: '',
  });

  const update = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    if (!user?.merchantId) {
      setValidationError('Your account is not linked to a merchant.');
      return;
    }

    const payload = {
      merchantId: user.merchantId,
      amount: Number(form.amount),
      currency: form.currency,
      paymentMethod: form.paymentMethod,
      cardDetails: {
        cardNumber: form.cardNumber.replace(/\s+/g, ''),
        expiryMonth: Number(form.expiryMonth),
        expiryYear: Number(form.expiryYear),
        cvv: form.cvv,
        cardholderName: form.cardholderName,
      },
      idempotencyKey: crypto.randomUUID(),
    };

    const parsed = CreatePaymentSchema.safeParse(payload);
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message || 'Invalid input');
      return;
    }

    createPayment.mutate(parsed.data, {
      onSuccess: (result) => router.push(`/payments/${result.id}`),
    });
  };

  const errorMessage =
    validationError ||
    (createPayment.error instanceof ApiClientError ? createPayment.error.message : createPayment.error ? 'Payment failed' : null);

  return (
    <Box maxWidth={560}>
      <Typography variant="h5" fontWeight={700} mb={3}>
        New Payment
      </Typography>

      <Paper variant="outlined" sx={{ p: 3 }}>
        <form onSubmit={handleSubmit}>
          <Stack spacing={2.5}>
            {errorMessage && <Alert severity="error">{errorMessage}</Alert>}

            <Grid container spacing={2}>
              <Grid item xs={8}>
                <TextField
                  label="Amount"
                  type="number"
                  inputProps={{ step: '0.01', min: '0' }}
                  value={form.amount}
                  onChange={update('amount')}
                  fullWidth
                  required
                />
              </Grid>
              <Grid item xs={4}>
                <TextField
                  select
                  label="Currency"
                  value={form.currency}
                  onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value as Currency }))}
                  fullWidth
                >
                  {Object.values(Currency).map((c) => (
                    <MenuItem key={c} value={c}>
                      {c}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
            </Grid>

            <TextField
              select
              label="Payment method"
              value={form.paymentMethod}
              onChange={(e) => setForm((f) => ({ ...f, paymentMethod: e.target.value as PaymentMethod }))}
              fullWidth
            >
              {Object.values(PaymentMethod).map((m) => (
                <MenuItem key={m} value={m}>
                  {m.replace('_', ' ')}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              label="Cardholder name"
              value={form.cardholderName}
              onChange={update('cardholderName')}
              fullWidth
              required
            />
            <TextField
              label="Card number"
              value={form.cardNumber}
              onChange={update('cardNumber')}
              placeholder="4111 1111 1111 1111"
              fullWidth
              required
            />

            <Grid container spacing={2}>
              <Grid item xs={4}>
                <TextField label="Exp. month" type="number" value={form.expiryMonth} onChange={update('expiryMonth')} fullWidth required />
              </Grid>
              <Grid item xs={4}>
                <TextField label="Exp. year" type="number" value={form.expiryYear} onChange={update('expiryYear')} fullWidth required />
              </Grid>
              <Grid item xs={4}>
                <TextField label="CVV" value={form.cvv} onChange={update('cvv')} fullWidth required />
              </Grid>
            </Grid>

            <Button type="submit" variant="contained" size="large" disabled={createPayment.isPending}>
              {createPayment.isPending ? 'Authorizing…' : 'Authorize Payment'}
            </Button>
          </Stack>
        </form>
      </Paper>
    </Box>
  );
}
