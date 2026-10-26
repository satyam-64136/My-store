import sqlite3

def create_database_and_table():
    try:
        # Connect to SQLite database (it will create the file if it doesn't exist)
        connection = sqlite3.connect('users.db')  # This creates or connects to users.db
        cursor = connection.cursor()

        # Create users table if it doesn't exist
        create_table_query = '''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            phone TEXT NOT NULL,
            state TEXT NOT NULL,
            district TEXT NOT NULL,
            language TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        '''
        cursor.execute(create_table_query)

        print("Database 'users.db' and table 'users' created successfully!")

    except sqlite3.Error as e:
        print(f"SQLite error: {e}")

    finally:
        if connection:
            cursor.close()
            connection.close()
            print("Connection closed.")

# Run the function
create_database_and_table()
