/** Accept the company slug or its Bukku login URL; reject pasted commands. */
export function companySubdomain(value: string): string {
  const input = value.trim().toLowerCase();
  if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input)) return input;
  const match = /^(?:https:\/\/)?([a-z0-9]+(?:-[a-z0-9]+)*)\.bukku\.my\/?$/.exec(input);
  if (match) return match[1];
  throw new Error('BUKKU_COMPANY_SUBDOMAIN must be a company slug or HTTPS Bukku login URL.');
}
