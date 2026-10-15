import { LoginForm } from "./form";

export default function LoginPage() {
  return (
    <main className="mx-auto mt-32 max-w-sm px-4">
      <h1 className="mb-1 text-xl font-semibold">PostFlow</h1>
      <p className="mb-6 text-sm text-muted">Your LinkedIn and X presence, on autopilot.</p>
      <LoginForm />
    </main>
  );
}
