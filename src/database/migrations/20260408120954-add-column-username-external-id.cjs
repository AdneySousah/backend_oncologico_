// Exemplo da migration
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('users', 'username', {
      type: Sequelize.STRING,
      allowNull: true,
      unique: true,
    });
    
    await queryInterface.addColumn('users', 'external_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      unique: true,
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('users', 'username');
    await queryInterface.removeColumn('users', 'external_id');
  }
};