const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const port = 3000;

// Set up multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Initialize SQLite database
let db = new sqlite3.Database('expense_tracker.db', (err) => {
  if (err) {
    console.error('Error connecting to database:', err.message);
  } else {
    console.log('Connected to SQLite database.');
    initializeDatabase(db);
  }
});

// Function to initialize database schema and ensure Income/Expense accounts
function initializeDatabase(database) {
  database.run(`
    CREATE TABLE IF NOT EXISTS accounts (
      name TEXT PRIMARY KEY,
      start INTEGER NOT NULL,
      current_balance INTEGER NOT NULL,
      transaction_list TEXT DEFAULT '[]'
    )
  `, (err) => {
    if (err) console.error('Error creating accounts table:', err.message);
    else {
      // Ensure "Income" and "Expense" accounts exist
      database.get(`SELECT name FROM accounts WHERE name = ?`, ['Income'], (err, row) => {
        if (err) console.error('Error checking Income account:', err.message);
        if (!row) {
          database.run(
            `INSERT INTO accounts (name, start, current_balance, transaction_list) VALUES (?, ?, ?, ?)`,
            ['Income', 0, 0, '[]'],
            (err) => {
              if (err) console.error('Error creating Income account:', err.message);
              else console.log('Created Income account');
            }
          );
        }
      });
      database.get(`SELECT name FROM accounts WHERE name = ?`, ['Expense'], (err, row) => {
        if (err) console.error('Error checking Expense account:', err.message);
        if (!row) {
          database.run(
            `INSERT INTO accounts (name, start, current_balance, transaction_list) VALUES (?, ?, ?, ?)`,
            ['Expense', 0, 0, '[]'],
            (err) => {
              if (err) console.error('Error creating Expense account:', err.message);
              else console.log('Created Expense account');
            }
          );
        }
      });
    }
  });
  database.run(`
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

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve the transactions page
app.get('/transactions', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'transactions.html'));
});

// Handle account creation
app.post('/init-account', (req, res) => {
  console.log('Received account body:', req.body);
  const { name, start } = req.body;

  if (!name || !start || isNaN(start)) {
    console.log('Account validation failed:', { name, start });
    return res.status(400).send('Invalid input: name and valid starting balance are required.');
  }
  if (name === 'Income' || name === 'Expense') {
    console.log('Attempt to create reserved account:', name);
    return res.status(400).send('Cannot create account named Income or Expense.');
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

// Handle transaction creation
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
      balance: account.name === 'Income' || account.name === 'Expense'
        ? 0
        : account.name === from_account
          ? account.current_balance - amountInt
          : account.name === to_account
            ? account.current_balance + amountInt
            : account.current_balance
    }));

    console.log('Computed accountsBalance:', accountsBalance);

    // Calculate available_money for from_account
    const availableMoney = fromAccount.name === 'Income' ? 0 : fromAccount.current_balance - amountInt;

    // Insert transaction
    db.run(
      `INSERT INTO transactions (from_account, to_account, amount, available_money, type, category, comment, accounts_balance) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [from_account, to_account, amountInt, availableMoney, type, category, comment || '', JSON.stringify(accountsBalance)],
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
          const newBalance = from_account === 'Income' || from_account === 'Expense' ? 0 : row.current_balance - amountInt;
          db.run(
            `UPDATE accounts SET transaction_list = ?, current_balance = ? WHERE name = ?`,
            [JSON.stringify(transactionList), newBalance, from_account],
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
                const newToBalance = to_account === 'Income' || to_account === 'Expense' ? 0 : row.current_balance + amountInt;
                db.run(
                  `UPDATE accounts SET transaction_list = ?, current_balance = ? WHERE name = ?`,
                  [JSON.stringify(toTransactionList), newToBalance, to_account],
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


app.get('/api/transactions/:id', (req, res) => {
  const transactionId = req.params.id;
  db.get(`SELECT * FROM transactions WHERE id = ?`, [transactionId], (err, row) => {
    if (err) {
      console.error('Error fetching transaction:', err.message);
      return res.status(500).json({ error: `Error fetching transaction: ${err.message}` });
    }
    if (!row) {
      return res.status(404).json({ error: `No transaction found with ID: ${transactionId}` });
    }
    console.log('Sending transaction data:', row);
    const accountsBalance = JSON.parse(row.accounts_balance);
    res.json({ transaction: row, accountsBalance });
  });
});

// Endpoint สำหรับหน้า transaction
app.get('/transactions/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'transaction-id.html'));
});

// Endpoint สำหรับหน้าแก้ไข transaction
app.get('/transactions/:id/edit', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'edit_transaction.html'));
});

// API endpoint สำหรับอัพเดทข้อมูล transaction
app.post('/api/transactions/:id', (req, res) => {
  const transactionId = req.params.id;
  const { from_account, to_account, amount, comment, category, type, created_at } = req.body;
  
  // ตรวจสอบว่าข้อมูลครบถ้วน
  if (!from_account || !to_account || !amount || !category || !type || !created_at) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // อัพเดทข้อมูลในฐานข้อมูล
  const query = `
    UPDATE transactions 
    SET from_account = ?, to_account = ?, amount = ?, comment = ?, category = ?, type = ?, created_at = ?
    WHERE id = ?
  `;
  db.run(query, [from_account, to_account, amount, comment || '', category, type, created_at, transactionId], (err) => {
    if (err) {
      console.error('Error updating transaction:', err.message);
      return res.status(500).json({ error: `Error updating transaction: ${err.message}` });
    }
    console.log('Transaction updated:', { id: transactionId, from_account, to_account, amount, comment, category, type, created_at });
    res.json({ message: 'Transaction updated successfully' });
  });
});

// Endpoint สำหรับหน้า error
app.get('/error.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'error.html'), {
    headers: { 'X-Error-Message': 'An error occurred', 'X-Status': '500' }
  });
});

// API endpoint สำหรับลบ transaction
app.delete('/api/transactions/:id', (req, res) => {
  const transactionId = req.params.id;
  db.run(`DELETE FROM transactions WHERE id = ?`, [transactionId], function(err) {
    if (err) {
      console.error('Error deleting transaction:', err.message);
      return res.status(500).json({ error: `Error deleting transaction: ${err.message}` });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: `No transaction found with ID: ${transactionId}` });
    }
    console.log('Transaction deleted:', { id: transactionId });
    res.json({ message: 'Transaction deleted successfully' });
  });
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

// Get all transactions to display
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
      console.log('Sending transactions data:', rows);
      res.json(rows);
    }
  );
});

// Clear database
app.post('/clear-database', (req, res) => {
  console.log('Clearing database...');
  db.run(`DELETE FROM transactions`, (err) => {
    if (err) {
      console.error('Error clearing transactions:', err.message);
      return res.status(500).send('Error clearing transactions.');
    }
    db.run(`DELETE FROM accounts`, (err) => {
      if (err) {
        console.error('Error clearing accounts:', err.message);
        return res.status(500).send('Error clearing accounts.');
      }
      // Recreate Income and Expense accounts
      db.run(
        `INSERT INTO accounts (name, start, current_balance, transaction_list) VALUES (?, ?, ?, ?)`,
        ['Income', 0, 0, '[]'],
        (err) => {
          if (err) {
            console.error('Error recreating Income account:', err.message);
            return res.status(500).send('Error recreating Income account.');
          }
          db.run(
            `INSERT INTO accounts (name, start, current_balance, transaction_list) VALUES (?, ?, ?, ?)`,
            ['Expense', 0, 0, '[]'],
            (err) => {
              if (err) {
                console.error('Error recreating Expense account:', err.message);
                return res.status(500).send('Error recreating Expense account.');
              }
              console.log('Database cleared and Income/Expense accounts recreated');
              res.status(200).send('Database cleared successfully.');
            }
          );
        }
      );
    });
  });
});

// Import database
app.post('/import-db', upload.single('dbfile'), (req, res) => {
  if (!req.file) {
    console.error('No file uploaded');
    return res.status(400).send('No file uploaded.');
  }

  const tempPath = req.file.path;
  const targetPath = path.join(__dirname, 'expense_tracker.db');

  // Validate the uploaded file by attempting to open it as an SQLite database
  const tempDb = new sqlite3.Database(tempPath, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
      console.error('Error opening uploaded database:', err.message);
      fs.unlink(tempPath, (unlinkErr) => {
        if (unlinkErr) console.error('Error deleting invalid file:', unlinkErr.message);
      });
      return res.status(400).send('Invalid SQLite database file.');
    }

    // Verify required tables exist
    tempDb.all(`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('accounts', 'transactions')`, (err, tables) => {
      if (err || tables.length !== 2) {
        console.error('Invalid database schema:', err ? err.message : 'Missing required tables');
        tempDb.close();
        fs.unlink(tempPath, (unlinkErr) => {
          if (unlinkErr) console.error('Error deleting invalid file:', unlinkErr.message);
        });
        return res.status(400).send('Invalid database schema.');
      }

      // Close the temporary database
      tempDb.close((err) => {
        if (err) {
          console.error('Error closing temporary database:', err.message);
          fs.unlink(tempPath, (unlinkErr) => {
            if (unlinkErr) console.error('Error deleting invalid file:', unlinkErr.message);
          });
          return res.status(500).send('Error closing temporary database.');
        }

        // Close the main database connection
        db.close((err) => {
          if (err) {
            console.error('Error closing main database:', err.message);
            fs.unlink(tempPath, (unlinkErr) => {
              if (unlinkErr) console.error('Error deleting invalid file:', unlinkErr.message);
            });
            return res.status(500).send('Error closing main database.');
          }

          // Replace the database file
          fs.rename(tempPath, targetPath, (err) => {
            if (err) {
              console.error('Error replacing database file:', err.message);
              fs.unlink(tempPath, (unlinkErr) => {
                if (unlinkErr) console.error('Error deleting invalid file:', unlinkErr.message);
              });
              return res.status(500).send('Error replacing database file.');
            }

            // Reconnect to the new database
            db = new sqlite3.Database(targetPath, (err) => {
              if (err) {
                console.error('Error reconnecting to database:', err.message);
                return res.status(500).send('Error reconnecting to database.');
              }

              // Ensure Income and Expense accounts exist
              initializeDatabase(db);
              console.log('Database imported and reconnected.');
              res.status(200).send('Database imported successfully.');
            });
          });
        });
      });
    });
  });
});

// Start server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});