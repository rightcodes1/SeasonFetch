export async function sendPasswordRecovery(auth, email, redirectTo) {
  const { error } = await auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}

export async function signOutFromAuth(auth) {
  const { error } = await auth.signOut();
  if (error) throw error;
}
