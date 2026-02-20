module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.createTable('user_operadoras', {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      user_id: {
        type: Sequelize.INTEGER,
        references: { model: 'users', key: 'id' }, // Aqui está a Foreign Key verdadeira
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE', // Se o usuário sumir, a relação some
        allowNull: false,
      },
      operadora_id: {
        type: Sequelize.INTEGER,
        references: { model: 'operadoras', key: 'id' }, // Outra Foreign Key verdadeira
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
        allowNull: false,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });
  },

  down: (queryInterface) => {
    return queryInterface.dropTable('user_operadoras');
  }
};