alter table financial_accounts
  add column if not exists color text not null default '#2563EB';

alter table financial_accounts
  drop constraint if exists financial_accounts_color_check;

alter table financial_accounts
  add constraint financial_accounts_color_check check (
    color in ('#2563EB', '#4F46E5', '#7C3AED', '#DB2777', '#E11D48', '#D97706', '#059669', '#0891B2')
  );
