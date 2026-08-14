'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import {
  Box,
  Typography,
  Paper,
  Stack,
  Grid,
  Button,
  Divider,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  CircularProgress,
  Alert,
} from '@mui/material';
import { Permission, PaymentStatus } from '@payment-platform/shared';
import { usePayment } from '@/hooks/usePayments';
import { useAuthStore } from '@/lib/auth-store';
import { PaymentStatusChip } from '@/components/PaymentStatusChip';
import { CapturePaymentDialog } from '@/components/CapturePaymentDialog';
import { RefundPaymentDialog } from '@/components/RefundPaymentDialog';
import { CancelPaymentDialog } from '@/components/CancelPaymentDialog';

function formatAmount(amount: string, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(amount));
}

export default function PaymentDetailPage() {
  const params = useParams<{ id: string }>();
  const { data: payment, isLoading, isError } = usePayment(params.id);
  const permissions = useAuthStore((s) => s.user?.permissions || []);

  const [dialog, setDialog] = useState<'capture' | 'refund' | 'cancel' | null>(null);

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" py={6}>
        <CircularProgress />
      </Box>
    );
  }

  if (isError || !payment) {
    return <Alert severity="error">Payment not found.</Alert>;
  }

  const canCapture = permissions.includes(Permission.CAPTURE_PAYMENT) && payment.status === PaymentStatus.AUTHORIZED;
  const canRefund =
    permissions.includes(Permission.REFUND_PAYMENT) &&
    (payment.status === PaymentStatus.CAPTURED || payment.status === PaymentStatus.PARTIALLY_REFUNDED);
  const canCancel =
    permissions.includes(Permission.CANCEL_PAYMENT) &&
    (payment.status === PaymentStatus.PENDING || payment.status === PaymentStatus.AUTHORIZED);

  const refundedSoFar = (payment.transactions || [])
    .filter((t) => t.type === 'REFUND' && (t.status === PaymentStatus.REFUNDED || t.status === PaymentStatus.PARTIALLY_REFUNDED))
    .reduce((sum, t) => sum + Number(t.amount), 0);
  const remainingRefundable = Number(payment.amount) - refundedSoFar;

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" mb={3}>
        <Box>
          <Typography variant="h5" fontWeight={700}>
            Payment {payment.id.slice(0, 8)}…
          </Typography>
          <Box mt={1}>
            <PaymentStatusChip status={payment.status} />
          </Box>
        </Box>
        <Stack direction="row" spacing={1.5}>
          {canCapture && (
            <Button variant="contained" onClick={() => setDialog('capture')}>
              Capture
            </Button>
          )}
          {canRefund && (
            <Button variant="contained" color="secondary" onClick={() => setDialog('refund')}>
              Refund
            </Button>
          )}
          {canCancel && (
            <Button variant="outlined" color="error" onClick={() => setDialog('cancel')}>
              Cancel
            </Button>
          )}
        </Stack>
      </Stack>

      <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
        <Grid container spacing={3}>
          <Grid item xs={6} sm={3}>
            <Typography variant="caption" color="text.secondary">
              Amount
            </Typography>
            <Typography variant="h6">{formatAmount(payment.amount, payment.currency)}</Typography>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Typography variant="caption" color="text.secondary">
              Method
            </Typography>
            <Typography variant="h6">{payment.paymentMethod.replace('_', ' ')}</Typography>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Typography variant="caption" color="text.secondary">
              Card
            </Typography>
            <Typography variant="h6">
              {payment.cardLast4 ? `${payment.cardBrand} •••• ${payment.cardLast4}` : '—'}
            </Typography>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Typography variant="caption" color="text.secondary">
              Created
            </Typography>
            <Typography variant="h6">{new Date(payment.createdAt).toLocaleDateString()}</Typography>
          </Grid>
        </Grid>
      </Paper>

      <Typography variant="h6" fontWeight={700} mb={1.5}>
        Transaction History
      </Typography>
      <Paper variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Type</TableCell>
              <TableCell>Amount</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Gateway ref.</TableCell>
              <TableCell>Time</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(payment.transactions || []).map((t) => (
              <TableRow key={t.id}>
                <TableCell>{t.type}</TableCell>
                <TableCell>{formatAmount(t.amount, payment.currency)}</TableCell>
                <TableCell>
                  <PaymentStatusChip status={t.status} />
                </TableCell>
                <TableCell>
                  <Typography variant="body2" fontFamily="monospace" color="text.secondary">
                    {t.gatewayTransactionId || '—'}
                  </Typography>
                </TableCell>
                <TableCell>{new Date(t.createdAt).toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <Divider sx={{ my: 3 }} />

      {dialog === 'capture' && (
        <CapturePaymentDialog
          paymentId={payment.id}
          defaultAmount={Number(payment.amount)}
          open
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'refund' && (
        <RefundPaymentDialog
          paymentId={payment.id}
          maxAmount={remainingRefundable}
          open
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'cancel' && <CancelPaymentDialog paymentId={payment.id} open onClose={() => setDialog(null)} />}
    </Box>
  );
}
