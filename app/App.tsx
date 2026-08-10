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
import {
  CrashScreen,
  DiceScreen,
  LimboScreen,
  MinesScreen,
  PlinkoScreen,
} from './src/screens/instant/games';
import { StoreScreen } from './src/screens/StoreScreen';
import { WalletScreen } from './src/screens/WalletScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { AgentScreen } from './src/screens/AgentScreen';
import { useAgentRole } from './src/api/useAgent';
import { AppGate } from './src/AppGate';
import { registerServiceWorker } from './src/pwa';
import { SLOT_GAMES } from './src/api/slot-games.generated';
import { Ticker } from './src/components/Ticker';
import { useCompactLayout } from './src/layout';

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

      {/* Every slot in the catalogue gets a route, all pointing at the same
          screen — it reads which game it is from the route name. Registering
          only the flagship left twenty-two games advertised in the lobby and
          unreachable when tapped, which is worse than not shipping them. */}
      {SLOT_GAMES.map((game) => (
        <Stack.Screen
          key={game.id}
          name={game.id}
          component={SlotsScreen}
          options={{ headerShown: true, title: game.name }}
        />
      ))}
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

      {/* The instant games. Each has its own screen but they share a shell —
          the balance, the stake chips and the request are identical across all
          five, so only the play area differs. */}
      <Stack.Screen name="juwa-crash" component={CrashScreen} options={{ headerShown: true, title: 'Crash' }} />
      <Stack.Screen name="juwa-limbo" component={LimboScreen} options={{ headerShown: true, title: 'Limbo' }} />
      <Stack.Screen name="juwa-dice" component={DiceScreen} options={{ headerShown: true, title: 'Dice' }} />
      <Stack.Screen name="juwa-plinko" component={PlinkoScreen} options={{ headerShown: true, title: 'Plinko' }} />
      <Stack.Screen name="juwa-mines" component={MinesScreen} options={{ headerShown: true, title: 'Mines' }} />
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
  Agent: 'people',
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
function TickerUnlessCramped() {
  return useCompactLayout() ? null : <Ticker />;
}

function Tabs() {
  const insets = useSafeAreaInsets();
  const compact = useCompactLayout();
  /**
   * The agent tab exists only for accounts that are agents.
   *
   * A fifth tab costs every player a fifth of the bar's width, and "Agent"
   * means nothing to somebody who is not one — so it is not merely disabled for
   * players, it is absent. While the role is still loading it is also absent,
   * which is the right way round: a tab that appears a beat late is a small
   * surprise, one that appears and then vanishes looks like a bug.
   *
   * This is presentation. Every `/agent/*` route re-resolves the caller's agent
   * record from their verified token, so a player who makes this tab appear in
   * their own browser reaches a screen where every request returns 404.
   */
  const { agent } = useAgentRole();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.gold.default,
        tabBarInactiveTintColor: colors.text.muted,
        // Hidden on a short screen. It costs about a sixth of the height a
        // phone has in landscape, and every screen it leads to is one tap away
        // through the back arrow anyway — whereas a spin button off the bottom
        // of the screen has no alternative route.
        tabBarStyle: compact
          ? { display: 'none' as const }
          : {
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
      {agent ? <Tab.Screen name="Agent" component={AgentScreen} /> : null}
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
            including the logged-out landing page — but not when height is the
            scarce resource. It is decoration, and it was costing a landscape
            player a row of symbols. */}
        <TickerUnlessCramped />
        <AppGate>
          <Tabs />
        </AppGate>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
