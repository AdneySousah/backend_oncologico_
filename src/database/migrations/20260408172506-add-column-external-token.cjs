// Exemplo da migration
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('users', 'external_token', {
      type: Sequelize.TEXT,
      allowNull: true,
      unique: true,
    });
    
  
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('users', 'external_token');

  }
};

