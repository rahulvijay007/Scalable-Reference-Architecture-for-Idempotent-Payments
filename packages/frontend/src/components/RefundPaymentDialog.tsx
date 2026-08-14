'use client';

import { useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button, Alert, Stack } from '@mui/material';
import { useRefundPayment } from '@/hooks/usePayments';
import { ApiClientError } from '@/lib/api-client';

export function RefundPaymentDialog({
  paymentId,
  maxAmount,
  open,
  onClose,
}: {
  paymentId: string;
  maxAmount: number;
  open: boolean;
  onClose: () => void;
}) {
  const refund = useRefundPayment(paymentId);
  const [amount, setAmount] = useState(String(maxAmount));
  const [reason, setReason] = useState('');

  const handleRefund = () => {
    refund.mutate({ amount: Number(amount), reason: reason || undefined }, { onSuccess: () => onClose() });
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Refund Payment</DialogTitle>
      <DialogContent>
        {refund.error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {refund.error instanceof ApiClientError ? refund.error.message : 'Refund failed'}
          </Alert>
        )}
        <Stack spacing={2} mt={1}>
          <TextField
            label="Amount"
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            helperText={`Up to ${maxAmount} remaining`}
            fullWidth
            autoFocus
          />
          <TextField label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} fullWidth />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" color="secondary" onClick={handleRefund} disabled={refund.isPending}>
          {refund.isPending ? 'Refunding…' : 'Refund'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
