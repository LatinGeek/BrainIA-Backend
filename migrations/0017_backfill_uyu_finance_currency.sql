update financial_accounts
set currency = 'UYU'
where currency is null;

update financial_transactions
set currency = 'UYU'
where currency is null or upper(currency) = 'UNKNOWN';

update financial_transaction_events
set currency = 'UYU'
where currency is null or upper(currency) = 'UNKNOWN';
