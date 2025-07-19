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
    // Create transactions table
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
        FOREIGN KEY (from_account) REFERENCES accounts(name),
        FOREIGN KEY (to_account) REFERENCES accounts(name)
      )
    `, (err) => {
      if (err) console.error('Error creating transactions table:', err.message);
    });
  }
});

// Middleware
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
  db.all(`SELECT name, start FROM accounts`, [], (err, rows) => {
    if (err) {
      console.error('Error fetching accounts:', err.message);
      return res.status(500).send('Error fetching accounts.');
    }
    res.json(rows);
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

// Calculate available_money for from_account
db.get(
    `SELECT start, transaction_list FROM accounts WHERE name = ?`,
    [from_account],
    (err, account) => {
    if (err || !account) {
        console.error('Error fetching from_account:', err?.message);
        return res.status(500).send('Error: Invalid from account.');
    }

    // Parse transaction_list to calculate current balance
    const transactions = JSON.parse(account.transaction_list || '[]');
    db.all(
        `SELECT amount, from_account, to_account FROM transactions WHERE id IN (${transactions.length ? transactions.join(',') : '0'})`,
        [],
        (err, txns) => {
        if (err) {
            console.error('Error fetching transactions:', err.message);
            return res.status(500).send('Error calculating balance.');
        }

        let balance = parseInt(account.start);
        txns.forEach(txn => {
            if (txn.from_account === from_account) balance -= txn.amount;
            if (txn.to_account === from_account) balance += txn.amount;
        });

        // Insert transaction
        db.run(
            `INSERT INTO transactions (from_account, to_account, amount, available_money, type, category, comment) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [from_account, to_account, parseInt(amount), balance - parseInt(amount), type, category, comment || ''],
            function (err) {
            if (err) {
                console.error('Error inserting transaction:', err.message);
                return res.status(500).send('Error creating transaction.');
            }

            const transactionId = this.lastID;

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
                        res.redirect('/');
                        }
                    );
                    });
                }
                );
            });
            }
        );
        }
    );
    }
);
});

app.get('/transactions', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'transactions.html'));
});

app.get('/transactions-data', (req, res) => {
db.all(
    `SELECT id, from_account, to_account, amount, available_money, type,

category, comment, created_at FROM transactions`,
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