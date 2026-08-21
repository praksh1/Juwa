import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '@juwa/ui';

const CRASH_STORAGE_KEY = 'juwa.client-crashes.v1';
const MAX_SAVED_CRASHES = 5;

type CrashRecord = {
  id: string;
  occurredAt: string;
  name: string;
  message: string;
  stack?: string;
  componentStack?: string;
};

type Props = React.PropsWithChildren;

type State = {
  error: Error | null;
  diagnosticId: string | null;
};

function makeDiagnosticId() {
  const randomPart = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${Date.now().toString(36).toUpperCase()}-${randomPart}`;
}

function saveCrash(record: CrashRecord) {
  // Never allow diagnostic storage to become another crash. The record contains
  // only the JavaScript error and component stack: no balance, auth token, seed,
  // player name, or other account data is captured.
  try {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    const existingValue = window.localStorage.getItem(CRASH_STORAGE_KEY);
    const existing = existingValue ? JSON.parse(existingValue) : [];
    const records = Array.isArray(existing) ? existing : [];
    window.localStorage.setItem(
      CRASH_STORAGE_KEY,
      JSON.stringify([record, ...records].slice(0, MAX_SAVED_CRASHES)),
    );
  } catch {
    // Safari can deny or clear localStorage under privacy and storage pressure.
    // The recovery screen must still render when that happens.
  }
}

/**
 * Last-resort protection around the complete app.
 *
 * A React render failure previously left the casino as an empty/black page,
 * particularly on memory-constrained mobile browsers. This boundary cannot
 * make a broken component continue safely, but it keeps a usable recovery
 * screen mounted and preserves a small local diagnostic for the next report.
 */
export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = {
    error: null,
    diagnosticId: null,
  };

  static getDerivedStateFromError(error: Error): State {
    return {
      error,
      diagnosticId: makeDiagnosticId(),
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const diagnosticId = this.state.diagnosticId ?? makeDiagnosticId();
    const record: CrashRecord = {
      id: diagnosticId,
      occurredAt: new Date().toISOString(),
      name: error.name || 'Error',
      message: error.message || 'Unknown client error',
      stack: error.stack,
      componentStack: info.componentStack || undefined,
    };

    saveCrash(record);
    console.error(`[Juwa recovery ${diagnosticId}]`, error, info.componentStack);

    if (!this.state.diagnosticId) {
      this.setState({ diagnosticId });
    }
  }

  private reload = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.reload();
      return;
    }

    // The shipped product is the web app. Keeping a reset path here also makes
    // the boundary safe in Expo's native preview without importing DevSettings.
    this.setState({ error: null, diagnosticId: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <View style={styles.screen} accessibilityRole="alert">
        <View style={styles.glow} />
        <View style={styles.card}>
          <Text style={styles.eyebrow}>GAME RECOVERY</Text>
          <Text style={styles.title}>The game needs a quick reload</Text>
          <Text style={styles.copy}>
            Something unexpected interrupted the display. Reloading will restore the casino and will not
            automatically place another bet.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reload the casino"
            onPress={this.reload}
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          >
            <Text style={styles.buttonText}>Reload game</Text>
          </Pressable>
          {this.state.diagnosticId ? (
            <Text selectable style={styles.diagnostic}>
              Support code: {this.state.diagnosticId}
            </Text>
          ) : null}
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    minHeight: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    padding: spacing.lg,
    backgroundColor: colors.surface.base,
  },
  glow: {
    position: 'absolute',
    width: 420,
    height: 420,
    borderRadius: 210,
    backgroundColor: 'rgba(217, 171, 61, 0.12)',
    transform: [{ scaleX: 1.4 }],
  },
  card: {
    width: '100%',
    maxWidth: 480,
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(217, 171, 61, 0.55)',
    backgroundColor: colors.surface.raised,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.45,
    shadowRadius: 30,
  },
  eyebrow: {
    color: colors.gold.default,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2.2,
  },
  title: {
    marginTop: spacing.sm,
    color: colors.text.primary,
    fontSize: 27,
    lineHeight: 34,
    fontWeight: '800',
    textAlign: 'center',
  },
  copy: {
    marginTop: spacing.md,
    color: colors.text.secondary,
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
  },
  button: {
    width: '100%',
    minHeight: 54,
    marginTop: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 27,
    borderWidth: 1,
    borderColor: '#F8DF87',
    backgroundColor: colors.gold.default,
    shadowColor: colors.gold.default,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
  },
  buttonPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.985 }],
  },
  buttonText: {
    color: '#16100A',
    fontSize: 18,
    fontWeight: '800',
  },
  diagnostic: {
    marginTop: spacing.lg,
    color: colors.text.muted,
    fontSize: 12,
    letterSpacing: 0.5,
  },
});
