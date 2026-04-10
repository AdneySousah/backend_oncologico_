module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('pacientes', 'external_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      unique: true,
    });
  },
  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('pacientes', 'external_id');
  }
};