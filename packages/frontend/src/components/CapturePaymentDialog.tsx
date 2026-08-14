'use client';

import { useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button, Alert } from '@mui/material';
import { useCapturePayment } from '@/hooks/usePayments';
import { ApiClientError } from '@/lib/api-client';

export function CapturePaymentDialog({
  paymentId,
  defaultAmount,
  open,
  onClose,
}: {
  paymentId: string;
  defaultAmount: number;
  open: boolean;
  onClose: () => void;
}) {
  const capture = useCapturePayment(paymentId);
  const [amount, setAmount] = useState(String(defaultAmount));

  const handleCapture = () => {
    capture.mutate({ amount: Number(amount) }, { onSuccess: () => onClose() });
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Capture Payment</DialogTitle>
      <DialogContent>
        {capture.error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {capture.error instanceof ApiClientError ? capture.error.message : 'Capture failed'}
          </Alert>
        )}
        <TextField
          label="Amount"
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          fullWidth
          autoFocus
          sx={{ mt: 1 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleCapture} disabled={capture.isPending}>
          {capture.isPending ? 'Capturing…' : 'Capture'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
