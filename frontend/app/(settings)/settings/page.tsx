import { redirect } from 'next/navigation';

// /settings is the shell's entry point, not a screen of its own — the cards it
// used to show are now rows in the settings rail. Land on Team, which is what
// people open Settings for.
export default function SettingsIndex() {
  redirect('/team-permissions');
}
