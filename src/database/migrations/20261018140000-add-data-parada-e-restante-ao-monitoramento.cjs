'use strict';

// Pausa temporária e descontinuação passam a registrar QUANDO o paciente
// parou de tomar e QUANTOS comprimidos tinha nesse dia:
//  - pausa: a data real vai em data_pausa_inicio (antes era sempre "agora",
//    a hora da ligação) — a retomada e o fim de caixa passam a ser calculados
//    a partir dela;
//  - descontinuação: data_descontinuacao (nova);
//  - os dois: qtd_restante_projetada (o que o sistema calculou pra essa data),
//    qtd_restante_informada (o que o paciente disse ter) e
//    qtd_restante_confirmada (true = confirmou a projeção; false = corrigiu).
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('monitoramento_medicamentos', 'data_descontinuacao', {
      type: Sequelize.DATEONLY,
      allowNull: true,
      comment: 'Primeiro dia em que o paciente não tomou mais o medicamento (descontinuação)'
    });
    await queryInterface.addColumn('monitoramento_medicamentos', 'qtd_restante_projetada', {
      type: Sequelize.INTEGER,
      allowNull: true,
      comment: 'Comprimidos que o sistema projetou que o paciente tinha na data em que parou (pausa ou descontinuação)'
    });
    await queryInterface.addColumn('monitoramento_medicamentos', 'qtd_restante_informada', {
      type: Sequelize.INTEGER,
      allowNull: true,
      comment: 'Comprimidos que o paciente informou ter na data em que parou (igual à projeção quando confirmou)'
    });
    await queryInterface.addColumn('monitoramento_medicamentos', 'qtd_restante_confirmada', {
      type: Sequelize.BOOLEAN,
      allowNull: true,
      comment: 'true = paciente confirmou a projeção; false = informou outra quantidade'
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('monitoramento_medicamentos', 'qtd_restante_confirmada');
    await queryInterface.removeColumn('monitoramento_medicamentos', 'qtd_restante_informada');
    await queryInterface.removeColumn('monitoramento_medicamentos', 'qtd_restante_projetada');
    await queryInterface.removeColumn('monitoramento_medicamentos', 'data_descontinuacao');
  }
};
