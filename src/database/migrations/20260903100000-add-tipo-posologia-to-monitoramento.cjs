'use strict';

// Adiciona suporte a posologias "fora do padrão" — hoje o sistema só sabe
// calcular "X comprimidos por dia, todo dia". Isso não cobre casos reais
// comuns em oncologia: ciclos de toma/pausa (ex: 7 dias toma, 7 pausa),
// uso a cada N dias (ex: a cada 15 dias, ou 1x por mês), e casos realmente
// irregulares (datas específicas marcadas manualmente).
//
// tipo_posologia com DEFAULT 'diaria' garante que todo registro já
// existente no banco continua se comportando exatamente como antes —
// nada muda retroativamente pra quem já está em acompanhamento.
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('monitoramento_medicamentos', 'tipo_posologia', {
      type: Sequelize.ENUM('diaria', 'ciclica', 'intervalo', 'personalizada'),
      allowNull: false,
      defaultValue: 'diaria',
    });

    // Usado só quando tipo_posologia = 'ciclica' (ex: toma 7, pausa 7)
    await queryInterface.addColumn('monitoramento_medicamentos', 'posologia_ciclo_dias_toma', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('monitoramento_medicamentos', 'posologia_ciclo_dias_pausa', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });

    // Usado só quando tipo_posologia = 'intervalo' (ex: a cada 15 dias)
    await queryInterface.addColumn('monitoramento_medicamentos', 'posologia_intervalo_dias', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });

    // Usado só quando tipo_posologia = 'personalizada' — lista de datas
    // (formato AAAA-MM-DD) marcadas manualmente, sem repetição automática.
    await queryInterface.addColumn('monitoramento_medicamentos', 'posologia_datas_personalizadas', {
      type: Sequelize.JSONB,
      allowNull: true,
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('monitoramento_medicamentos', 'posologia_datas_personalizadas');
    await queryInterface.removeColumn('monitoramento_medicamentos', 'posologia_intervalo_dias');
    await queryInterface.removeColumn('monitoramento_medicamentos', 'posologia_ciclo_dias_pausa');
    await queryInterface.removeColumn('monitoramento_medicamentos', 'posologia_ciclo_dias_toma');
    await queryInterface.removeColumn('monitoramento_medicamentos', 'tipo_posologia');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_monitoramento_medicamentos_tipo_posologia";');
  }
};
