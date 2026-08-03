import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, type Theme } from '@react-navigation/native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography } from '@juwa/ui';
import { LobbyScreen } from './src/screens/LobbyScreen';
import { SlotsScreen } from './src/screens/SlotsScreen';
import { BlackjackScreen } from './src/screens/BlackjackScreen';
import { RouletteScreen } from './src/screens/RouletteScreen';
import { StoreScreen } from './src/screens/StoreScreen';
import { WalletScreen } from './src/screens/WalletScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { AppGate } from './src/AppGate';
import { registerServiceWorker } from './src/pwa';
import { Ticker } from './src/components/Ticker';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

/**
 * The lobby is a stack so tapping a game pushes the game screen over it. The
 * tab bar stays visible underneath, which is what players expect from a casino
 * app — leaving a game is always one tap.
 */
function LobbyStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Games" component={LobbyScreen} />
      <Stack.Screen
        name="juwa-classic-slots"
        component={SlotsScreen}
        options={{ headerShown: true, title: 'Juwa Classic' }}
      />
      <Stack.Screen
        name="juwa-blackjack"
        component={BlackjackScreen}
        options={{ headerShown: true, title: 'Blackjack' }}
      />
      <Stack.Screen
        name="juwa-roulette-eu"
        component={RouletteScreen}
        options={{ headerShown: true, title: 'European Roulette' }}
      />
    </Stack.Navigator>
  );
}

/**
 * Navigation theme, driven entirely by our design tokens so the chrome around
 * the screens matches the screens themselves.
 */
const theme: Theme = {
  dark: true,
  colors: {
    primary: colors.gold.default,
    background: colors.surface.base,
    card: colors.surface.raised,
    text: colors.text.primary,
    border: colors.surface.border,
    notification: colors.neon.magenta,
  },
  fonts: {
    regular: { fontFamily: 'System', fontWeight: '400' },
    medium: { fontFamily: 'System', fontWeight: '500' },
    bold: { fontFamily: 'System', fontWeight: '700' },
    heavy: { fontFamily: 'System', fontWeight: '800' },
  },
};

/** Icon (24) + label line (16) + breathing room, before any safe-area inset. */
const TAB_BAR_CONTENT_HEIGHT = 60;

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  Lobby: 'game-controller',
  Store: 'cart',
  Wallet: 'wallet',
  Profile: 'person',
};

/**
 * The tab bar, sized explicitly.
 *
 * React Navigation's default height fits an icon and a label on iOS, where it
 * also adds the home-indicator inset. On the web build it does neither: the
 * browser reports no safe-area inset, the bar keeps its bare 49pt, and the
 * labels are cut off along the bottom edge of the screen. Since the web build
 * is the product, the bar is measured here instead — tall enough for icon plus
 * label, plus whatever inset the device actually reports.
 *
 * This lives in its own component because `useSafeAreaInsets` has to be read
 * below `SafeAreaProvider`, not in the component that renders it.
 */
function Tabs() {
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.gold.default,
        tabBarInactiveTintColor: colors.text.muted,
        tabBarStyle: {
          backgroundColor: colors.surface.raised,
          borderTopColor: colors.surface.border,
          height: TAB_BAR_CONTENT_HEIGHT + insets.bottom,
          paddingTop: spacing.xs,
          paddingBottom: insets.bottom + spacing.xs,
        },
        tabBarLabelStyle: {
          fontSize: typography.caption.fontSize,
          lineHeight: typography.caption.lineHeight,
        },
        tabBarIcon: ({ color, size }) => (
          <Ionicons name={ICONS[route.name] ?? 'ellipse'} size={size} color={color} />
        ),
      })}
    >
      <Tab.Screen name="Lobby" component={LobbyStack} />
      <Tab.Screen name="Store" component={StoreScreen} />
      <Tab.Screen name="Wallet" component={WalletScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

export default function App() {
  // Registers the offline shell. No-op off the web.
  React.useEffect(() => {
    registerServiceWorker();
  }, []);

  return (
    <SafeAreaProvider>
      <NavigationContainer theme={theme}>
        <StatusBar style="light" />
        {/* Pinned above the navigator so it is present on every screen,
            including the logged-out landing page. */}
        <Ticker />
        <AppGate>
          <Tabs />
        </AppGate>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
