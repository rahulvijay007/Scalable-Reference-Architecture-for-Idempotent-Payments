import { Chip, ChipProps } from '@mui/material';
import { PaymentStatus } from '@payment-platform/shared';

const STATUS_COLOR: Record<PaymentStatus, ChipProps['color']> = {
  [PaymentStatus.PENDING]: 'default',
  [PaymentStatus.AUTHORIZED]: 'info',
  [PaymentStatus.CAPTURED]: 'success',
  [PaymentStatus.REFUNDED]: 'secondary',
  [PaymentStatus.PARTIALLY_REFUNDED]: 'secondary',
  [PaymentStatus.FAILED]: 'error',
  [PaymentStatus.CANCELLED]: 'default',
  [PaymentStatus.EXPIRED]: 'default',
};

export function PaymentStatusChip({ status }: { status: PaymentStatus }) {
  return <Chip label={status.replace('_', ' ')} color={STATUS_COLOR[status]} size="small" variant="filled" />;
}
