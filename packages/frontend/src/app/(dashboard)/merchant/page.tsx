'use client';

import { useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Button,
  Stack,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  Chip,
  IconButton,
  Tooltip,
  CircularProgress,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useAuthStore } from '@/lib/auth-store';
import { useApiKeys, useCreateApiKey, useRevokeApiKey } from '@/hooks/useApiKeys';
import { ApiClientError } from '@/lib/api-client';

export default function MerchantPage() {
  const merchantId = useAuthStore((s) => s.user?.merchantId);
  const { data: apiKeys, isLoading } = useApiKeys(merchantId);
  const createKey = useCreateApiKey(merchantId);
  const revokeKey = useRevokeApiKey(merchantId);

  const [createOpen, setCreateOpen] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [revealedKey, setRevealedKey] = useState<string | null>(null);

  const handleCreate = () => {
    createKey.mutate(keyName, {
      onSuccess: (key) => {
        setRevealedKey(key.key);
        setCreateOpen(false);
        setKeyName('');
      },
    });
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h5" fontWeight={700}>
          API Keys
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
          Create API Key
        </Button>
      </Stack>

      {revealedKey && (
        <Alert
          severity="success"
          sx={{ mb: 3, alignItems: 'center' }}
          action={
            <Tooltip title="Copy">
              <IconButton
                size="small"
                onClick={() => navigator.clipboard.writeText(revealedKey)}
                aria-label="copy api key"
              >
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          }
          onClose={() => setRevealedKey(null)}
        >
          <Typography fontWeight={700}>Save this key now — it won&apos;t be shown again:</Typography>
          <Typography fontFamily="monospace" sx={{ wordBreak: 'break-all' }}>
            {revealedKey}
          </Typography>
        </Alert>
      )}

      {isLoading ? (
        <Box display="flex" justifyContent="center" py={6}>
          <CircularProgress />
        </Box>
      ) : (
        <Paper variant="outlined">
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Key</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Last used</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(apiKeys || []).map((key) => (
                <TableRow key={key.id}>
                  <TableCell>{key.name}</TableCell>
                  <TableCell>
                    <Typography fontFamily="monospace" variant="body2">
                      {key.key}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip label={key.isActive ? 'Active' : 'Revoked'} color={key.isActive ? 'success' : 'default'} size="small" />
                  </TableCell>
                  <TableCell>{key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : 'Never'}</TableCell>
                  <TableCell align="right">
                    {key.isActive && (
                      <Tooltip title="Revoke">
                        <IconButton size="small" onClick={() => revokeKey.mutate(key.id)} aria-label="revoke api key">
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {(apiKeys || []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} align="center">
                    <Typography color="text.secondary" py={2}>
                      No API keys yet.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Paper>
      )}

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Create API Key</DialogTitle>
        <DialogContent>
          {createKey.error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {createKey.error instanceof ApiClientError ? createKey.error.message : 'Failed to create key'}
            </Alert>
          )}
          <TextField
            label="Key name"
            placeholder="e.g. Production backend"
            value={keyName}
            onChange={(e) => setKeyName(e.target.value)}
            fullWidth
            autoFocus
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={!keyName || createKey.isPending}>
            {createKey.isPending ? 'Creating…' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
