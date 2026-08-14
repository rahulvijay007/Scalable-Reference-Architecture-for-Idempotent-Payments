'use client';

import { useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button, Alert } from '@mui/material';
import { useCancelPayment } from '@/hooks/usePayments';
import { ApiClientError } from '@/lib/api-client';

export function CancelPaymentDialog({ paymentId, open, onClose }: { paymentId: string; open: boolean; onClose: () => void }) {
  const cancel = useCancelPayment(paymentId);
  const [reason, setReason] = useState('');

  const handleCancel = () => {
    cancel.mutate({ reason: reason || undefined }, { onSuccess: () => onClose() });
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Cancel Payment</DialogTitle>
      <DialogContent>
        {cancel.error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {cancel.error instanceof ApiClientError ? cancel.error.message : 'Cancellation failed'}
          </Alert>
        )}
        <TextField
          label="Reason (optional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          fullWidth
          autoFocus
          sx={{ mt: 1 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Back</Button>
        <Button variant="contained" color="error" onClick={handleCancel} disabled={cancel.isPending}>
          {cancel.isPending ? 'Cancelling…' : 'Cancel Payment'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
