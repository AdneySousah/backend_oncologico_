module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('operadoras', 'external_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      unique: true,
    });
  },
  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('operadoras', 'external_id');
  }
};