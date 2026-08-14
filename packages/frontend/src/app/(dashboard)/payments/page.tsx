'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Box,
  Typography,
  Button,
  Stack,
  MenuItem,
  Select,
  Pagination,
  CircularProgress,
  Alert,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { PaymentStatus } from '@payment-platform/shared';
import { usePayments } from '@/hooks/usePayments';
import { PaymentTable } from '@/components/PaymentTable';

const PAGE_SIZE = 10;

export default function PaymentsPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>('');

  const { data, isLoading, isError } = usePayments({ page, limit: PAGE_SIZE, status: status || undefined });

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h5" fontWeight={700}>
          Payments
        </Typography>
        <Button component={Link} href="/payments/new" variant="contained" startIcon={<AddIcon />}>
          New Payment
        </Button>
      </Stack>

      <Stack direction="row" spacing={2} mb={2}>
        <Select
          size="small"
          displayEmpty
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="">All statuses</MenuItem>
          {Object.values(PaymentStatus).map((s) => (
            <MenuItem key={s} value={s}>
              {s.replace('_', ' ')}
            </MenuItem>
          ))}
        </Select>
      </Stack>

      {isLoading && (
        <Box display="flex" justifyContent="center" py={6}>
          <CircularProgress />
        </Box>
      )}

      {isError && <Alert severity="error">Failed to load payments.</Alert>}

      {data && (
        <>
          <PaymentTable payments={data.items} />
          {data.totalPages > 1 && (
            <Box display="flex" justifyContent="center" mt={3}>
              <Pagination count={data.totalPages} page={page} onChange={(_, p) => setPage(p)} color="primary" />
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
