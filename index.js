const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const port = 3000;

// Initialize SQLite database
const db = new sqlite3.Database('expense_tracker.db', (err) => {
    if (err) {
      console.error('Error connecting to database:', err.message);
    } else {
      console.log('Connected to SQLite database.');
      // Create accounts table with current_balance
      db.run(`
        CREATE TABLE IF NOT EXISTS accounts (
          name TEXT PRIMARY KEY,
          start INTEGER NOT NULL,
          current_balance INTEGER NOT NULL,
          transaction_list TEXT DEFAULT '[]'
        )
      `, (err) => {
        if (err) console.error('Error creating accounts table:', err.message);
      });
      // Create transactions table with accounts_balance
      db.run(`
        CREATE TABLE IF NOT EXISTS transactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          from_account TEXT,
          to_account TEXT,
          amount INTEGER NOT NULL,
          available_money INTEGER,
          type TEXT,
          category TEXT,
          comment TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          accounts_balance TEXT DEFAULT '[]',
          FOREIGN KEY (from_account) REFERENCES accounts(name),
          FOREIGN KEY (to_account) REFERENCES accounts(name)
        )
      `, (err) => {
        if (err) console.error('Error creating transactions table:', err.message);
      });
    }
  });

app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies
app.use(express.json()); // Parse JSON bodies (optional)
app.use(express.static('public')); // Serve static files

// Serve the account creation form
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Handle account creation
app.post('/init-account', (req, res) => {
    console.log('Received account body:', req.body);
    const { name, start } = req.body;
  
    if (!name || !start || isNaN(start)) {
      console.log('Account validation failed:', { name, start });
      return res.status(400).send('Invalid input: name and valid starting balance are required.');
    }
  
    const startBalance = parseInt(start);
    db.run(
      `INSERT INTO accounts (name, start, current_balance, transaction_list) VALUES (?, ?, ?, ?)`,
      [name, startBalance, startBalance, '[]'],
      function (err) {
        if (err) {
          console.error('Error inserting account:', err.message);
          return res.status(500).send('Error creating account.');
        }
        console.log('Account created:', { name, start, current_balance: startBalance });
        res.redirect('/');
      }
    );
  });
  

// Get all accounts with current balance
app.get('/accounts', (req, res) => {
    db.all(`SELECT name, current_balance FROM accounts`, [], (err, accounts) => {
      if (err) {
        console.error('Error fetching accounts:', err.message);
        return res.status(500).send('Error fetching accounts.');
      }
      console.log('Sending accounts data:', accounts);
      res.json(accounts.map(acc => ({ name: acc.name, balance: acc.current_balance })));
    });
  });
// Serve the database file for download (read-only)
app.get('/db', (req, res) => {
  const dbPath = path.join(__dirname, 'expense_tracker.db');
  res.download(dbPath, 'expense_tracker.db', (err) => {
    if (err) {
      console.error('Error sending database file:', err.message);
      res.status(500).send('Could not send database file.');
    }
  });
});

app.post('/add-transaction', (req, res) => {
    console.log('Received transaction body:', req.body);
    const { from_account, to_account, amount, type, category, comment } = req.body;
  
    if (!from_account || !to_account || !amount || isNaN(amount) || !type || !category) {
      console.log('Transaction validation failed:', { from_account, to_account, amount, type, category });
      return res.status(400).send('Invalid input: from, to, amount, type, and category are required.');
    }
  
    const amountInt = parseInt(amount);
  
    // Fetch all accounts to calculate balances
    db.all(`SELECT name, start, current_balance, transaction_list FROM accounts`, [], (err, accounts) => {
      if (err) {
        console.error('Error fetching accounts:', err.message);
        return res.status(500).send('Error fetching accounts.');
      }
  
      console.log('Fetched accounts:', accounts);
  
      const fromAccount = accounts.find(acc => acc.name === from_account);
      const toAccount = accounts.find(acc => acc.name === to_account);
      if (!fromAccount || !toAccount) {
        console.error('Invalid account:', { from_account, to_account });
        return res.status(500).send('Error: Invalid from or to account.');
      }
  
      // Calculate accounts_balance for all accounts
      const accountsBalance = accounts.map(account => ({
        name: account.name,
        balance: account.name === from_account
          ? account.current_balance - amountInt
          : account.name === to_account
            ? account.current_balance + amountInt
            : account.current_balance
      }));
  
      console.log('Computed accountsBalance:', accountsBalance);
  
      // Insert transaction
      db.run(
        `INSERT INTO transactions (from_account, to_account, amount, available_money, type, category, comment, accounts_balance) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [from_account, to_account, amountInt, fromAccount.current_balance - amountInt, type, category, comment || '', JSON.stringify(accountsBalance)],
        function (err) {
          if (err) {
            console.error('Error inserting transaction:', err.message);
            return res.status(500).send('Error creating transaction.');
          }
  
          const transactionId = this.lastID;
          console.log('Inserted transaction ID:', transactionId, 'with accounts_balance:', JSON.stringify(accountsBalance));
  
          // Update transaction_list and current_balance for from_account
          db.get(`SELECT transaction_list, current_balance FROM accounts WHERE name = ?`, [from_account], (err, row) => {
            if (err) {
              console.error('Error fetching from_account transaction_list:', err.message);
              return res.status(500).send('Error updating account.');
            }
            const transactionList = JSON.parse(row.transaction_list || '[]');
            transactionList.push(transactionId);
            db.run(
              `UPDATE accounts SET transaction_list = ?, current_balance = ? WHERE name = ?`,
              [JSON.stringify(transactionList), row.current_balance - amountInt, from_account],
              (err) => {
                if (err) {
                  console.error('Error updating from_account:', err.message);
                  return res.status(500).send('Error updating account.');
                }
  
                // Update transaction_list and current_balance for to_account
                db.get(`SELECT transaction_list, current_balance FROM accounts WHERE name = ?`, [to_account], (err, row) => {
                  if (err) {
                    console.error('Error fetching to_account transaction_list:', err.message);
                    return res.status(500).send('Error updating account.');
                  }
                  const toTransactionList = JSON.parse(row.transaction_list || '[]');
                  toTransactionList.push(transactionId);
                  db.run(
                    `UPDATE accounts SET transaction_list = ?, current_balance = ? WHERE name = ?`,
                    [JSON.stringify(toTransactionList), row.current_balance + amountInt, to_account],
                    (err) => {
                      if (err) {
                        console.error('Error updating to_account:', err.message);
                        return res.status(500).send('Error updating account.');
                      }
                      console.log('Transaction and accounts updated successfully');
                      res.redirect('/');
                    }
                  );
                });
              }
            );
          });
        }
      );
    });
  });

app.get('/transactions', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'transactions.html'));
});

app.get('/transactions-data', (req, res) => {
    db.all(
      `SELECT id, from_account, to_account, amount, available_money, type, category, comment, created_at, accounts_balance 
       FROM transactions`,
      [],
      (err, rows) => {
        if (err) {
          console.error('Error fetching transactions:', err.message);
          return res.status(500).send('Error fetching transactions.');
        }
        res.json(rows);
      }
    );
  });

// Start server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});