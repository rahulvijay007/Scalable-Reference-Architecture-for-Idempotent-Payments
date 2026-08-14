'use client';

import { useRouter } from 'next/navigation';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Typography,
  Box,
} from '@mui/material';
import { Payment } from '@/lib/types';
import { PaymentStatusChip } from './PaymentStatusChip';

function formatAmount(amount: string, currency: string) {
  const value = Number(amount);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);
}

export function PaymentTable({ payments }: { payments: Payment[] }) {
  const router = useRouter();

  if (payments.length === 0) {
    return (
      <Box py={6} textAlign="center">
        <Typography color="text.secondary">No payments found.</Typography>
      </Box>
    );
  }

  return (
    <TableContainer component={Paper} variant="outlined">
      <Table>
        <TableHead>
          <TableRow>
            <TableCell>Payment</TableCell>
            <TableCell>Amount</TableCell>
            <TableCell>Method</TableCell>
            <TableCell>Card</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Created</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {payments.map((payment) => (
            <TableRow
              key={payment.id}
              hover
              onClick={() => router.push(`/payments/${payment.id}`)}
              sx={{ cursor: 'pointer' }}
            >
              <TableCell>
                <Typography variant="body2" fontFamily="monospace">
                  {payment.id.slice(0, 8)}…
                </Typography>
              </TableCell>
              <TableCell>{formatAmount(payment.amount, payment.currency)}</TableCell>
              <TableCell>{payment.paymentMethod.replace('_', ' ')}</TableCell>
              <TableCell>{payment.cardLast4 ? `${payment.cardBrand} •••• ${payment.cardLast4}` : '—'}</TableCell>
              <TableCell>
                <PaymentStatusChip status={payment.status} />
              </TableCell>
              <TableCell>{new Date(payment.createdAt).toLocaleString()}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
