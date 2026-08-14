'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  AppBar,
  Toolbar,
  Typography,
  Box,
  Button,
  Chip,
  Stack,
} from '@mui/material';
import PaymentsIcon from '@mui/icons-material/Payments';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import LogoutIcon from '@mui/icons-material/Logout';
import { useAuthStore } from '@/lib/auth-store';
import { useLogout } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/payments', label: 'Payments', icon: <PaymentsIcon fontSize="small" /> },
  { href: '/merchant', label: 'API Keys', icon: <VpnKeyIcon fontSize="small" /> },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const logout = useLogout();
  const router = useRouter();

  const handleLogout = () => {
    logout.mutate(undefined, { onSettled: () => router.push('/login') });
  };

  return (
    <Box minHeight="100vh" bgcolor="background.default">
      <AppBar position="sticky" color="inherit">
        <Toolbar sx={{ gap: 3 }}>
          <Typography variant="h6" fontWeight={700} color="primary.main">
            Payment Platform
          </Typography>

          <Stack direction="row" spacing={1} flexGrow={1}>
            {NAV_ITEMS.map((item) => (
              <Button
                key={item.href}
                component={Link}
                href={item.href}
                startIcon={item.icon}
                color={pathname?.startsWith(item.href) ? 'primary' : 'inherit'}
                sx={{ fontWeight: pathname?.startsWith(item.href) ? 700 : 400 }}
              >
                {item.label}
              </Button>
            ))}
          </Stack>

          {user && (
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Chip label={user.role} size="small" color="secondary" variant="outlined" />
              <Typography variant="body2" color="text.secondary">
                {user.email}
              </Typography>
              <Button size="small" startIcon={<LogoutIcon fontSize="small" />} onClick={handleLogout}>
                Sign out
              </Button>
            </Stack>
          )}
        </Toolbar>
      </AppBar>

      <Box component="main" maxWidth="lg" mx="auto" px={3} py={4}>
        {children}
      </Box>
    </Box>
  );
}
