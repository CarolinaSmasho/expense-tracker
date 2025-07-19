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
    // Create accounts table
    db.run(`
      CREATE TABLE IF NOT EXISTS accounts (
        name TEXT PRIMARY KEY,
        start INTEGER NOT NULL,
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
  console.log('Received body:', req.body); // Debug: Log the request body
  const { name, start } = req.body;

  if (!name || !start || isNaN(start)) {
    console.log('Validation failed:', { name, start });
    return res.status(400).send('Invalid input: name and valid starting balance are required.');
  }

  db.run(
    `INSERT INTO accounts (name, start, transaction_list) VALUES (?, ?, ?)`,
    [name, parseInt(start), '[]'],
    function (err) {
      if (err) {
        console.error('Error inserting account:', err.message);
        return res.status(500).send('Error creating account.');
      }
      console.log('Account created:', { name, start });
      res.redirect('/'); // Redirect to main page
    }
  );
});

// Get all accounts to display
app.get('/accounts', (req, res) => {
    db.all(`SELECT name, start, transaction_list FROM accounts`, [], (err, accounts) => {
      if (err) {
        console.error('Error fetching accounts:', err.message);
        return res.status(500).send('Error fetching accounts.');
      }
  
      const results = [];
      const promises = accounts.map(account => {
        return new Promise((resolve) => {
          const transactionIds = JSON.parse(account.transaction_list || '[]');
          if (transactionIds.length === 0) {
            resolve({ name: account.name, balance: account.start });
          } else {
            db.get(
              `SELECT available_money 
               FROM transactions 
               WHERE id IN (${transactionIds.join(',')}) 
               AND from_account = ? 
               ORDER BY created_at DESC LIMIT 1`,
              [account.name],
              (err, transaction) => {
                if (err) {
                  console.error('Error fetching transaction for balance:', err.message);
                  resolve({ name: account.name, balance: account.start });
                } else if (transaction) {
                  resolve({ name: account.name, balance: transaction.available_money });
                } else {
                  db.all(
                    `SELECT amount, from_account, to_account 
                     FROM transactions 
                     WHERE id IN (${transactionIds.join(',')})`,
                    [],
                    (err, txns) => {
                      if (err) {
                        console.error('Error fetching all transactions:', err.message);
                        resolve({ name: account.name, balance: account.start });
                      } else {
                        let balance = parseInt(account.start);
                        txns.forEach(txn => {
                          if (txn.from_account === account.name) balance -= txn.amount;
                          if (txn.to_account === account.name) balance += txn.amount;
                        });
                        resolve({ name: account.name, balance });
                      }
                    }
                  );
                }
              }
            );
          }
        });
      });
  
      Promise.all(promises).then(results => {
        res.json(results);
      }).catch(err => {
        console.error('Error processing accounts:', err.message);
        res.status(500).send('Error processing accounts.');
      });
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
  
    // Fetch all accounts to calculate balances
    db.all(`SELECT name, start, transaction_list FROM accounts`, [], (err, accounts) => {
      if (err) {
        console.error('Error fetching accounts:', err.message);
        return res.status(500).send('Error fetching accounts.');
      }
  
      console.log('Fetched accounts:', accounts);
  
      // Calculate balances for all accounts
      const accountsBalance = [];
      let fromBalance = null;
  
      const promises = accounts.map(account => {
        return new Promise((resolve) => {
          const transactionIds = JSON.parse(account.transaction_list || '[]');
          let balance = parseInt(account.start);
  
          console.log(`Calculating balance for account: ${account.name}, start: ${balance}, transactionIds:`, transactionIds);
  
          if (transactionIds.length === 0) {
            // Apply the current transaction
            if (account.name === from_account) balance -= parseInt(amount);
            if (account.name === to_account) balance += parseInt(amount);
            if (account.name === from_account) fromBalance = balance;
            resolve({ name: account.name, balance });
          } else {
            db.all(
              `SELECT amount, from_account, to_account FROM transactions WHERE id IN (${transactionIds.join(',')})`,
              [],
              (err, txns) => {
                if (err) {
                  console.error(`Error fetching transactions for ${account.name}:`, err.message);
                  resolve({ name: account.name, balance });
                } else {
                  console.log(`Transactions for ${account.name}:`, txns);
                  txns.forEach(txn => {
                    if (txn.from_account === account.name) balance -= txn.amount;
                    if (txn.to_account === account.name) balance += txn.amount;
                  });
                  // Apply the current transaction
                  if (account.name === from_account) balance -= parseInt(amount);
                  if (account.name === to_account) balance += parseInt(amount);
                  if (account.name === from_account) fromBalance = balance;
                  resolve({ name: account.name, balance });
                }
              }
            );
          }
        });
      });
  
      Promise.all(promises).then(accountsBalance => {
        console.log('Computed accountsBalance:', accountsBalance);
        if (fromBalance === null) {
          const fromAccount = accounts.find(acc => acc.name === from_account);
          if (!fromAccount) {
            console.error('From account not found:', from_account);
            return res.status(500).send('Error: Invalid from account.');
          }
          fromBalance = parseInt(fromAccount.start) - parseInt(amount);
        }
  
        // Insert transaction
        db.run(
          `INSERT INTO transactions (from_account, to_account, amount, available_money, type, category, comment, accounts_balance) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [from_account, to_account, parseInt(amount), fromBalance, type, category, comment || '', JSON.stringify(accountsBalance)],
          function (err) {
            if (err) {
              console.error('Error inserting transaction:', err.message);
              return res.status(500).send('Error creating transaction.');
            }
  
            const transactionId = this.lastID;
            console.log('Inserted transaction ID:', transactionId);
  
            // Update transaction_list for from_account
            db.get(`SELECT transaction_list FROM accounts WHERE name = ?`, [from_account], (err, row) => {
              if (err) {
                console.error('Error fetching from_account transaction_list:', err.message);
                return res.status(500).send('Error updating account.');
              }
              const transactionList = JSON.parse(row.transaction_list || '[]');
              transactionList.push(transactionId);
              db.run(
                `UPDATE accounts SET transaction_list = ? WHERE name = ?`,
                [JSON.stringify(transactionList), from_account],
                (err) => {
                  if (err) {
                    console.error('Error updating from_account:', err.message);
                    return res.status(500).send('Error updating account.');
                  }
  
                  // Update transaction_list for to_account
                  db.get(`SELECT transaction_list FROM accounts WHERE name = ?`, [to_account], (err, row) => {
                    if (err) {
                      console.error('Error fetching to_account transaction_list:', err.message);
                      return res.status(500).send('Error updating account.');
                    }
                    const toTransactionList = JSON.parse(row.transaction_list || '[]');
                    toTransactionList.push(transactionId);
                    db.run(
                      `UPDATE accounts SET transaction_list = ? WHERE name = ?`,
                      [JSON.stringify(toTransactionList), to_account],
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
      }).catch(err => {
        console.error('Error processing account balances:', err.message);
        res.status(500).send('Error processing account balances.');
      });
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