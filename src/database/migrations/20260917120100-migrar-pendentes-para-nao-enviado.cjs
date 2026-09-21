'use strict';

// Migra os pacientes que hoje estão como "Pendente" para "Não Enviado" —
// ver a migration anterior (20260917120000) pra entender a decisão. Numa
// migration separada porque o Postgres não permite usar um valor de enum
// recém-criado na mesma transação em que ele foi adicionado.
module.exports = {
  up: async (queryInterface) => {
    await queryInterface.sequelize.query(
      `UPDATE pacientes SET status_termo = 'Nao Enviado' WHERE status_termo = 'Pendente';`
    );
    // Pacientes novos (sincronizados) nascem como "Não Enviado" — antes o
    // padrão da coluna era "Pendente", o que não fazia mais sentido no
    // novo modelo de 4 status.
    await queryInterface.sequelize.query(
      `ALTER TABLE pacientes ALTER COLUMN status_termo SET DEFAULT 'Nao Enviado';`
    );
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.query(
      `ALTER TABLE pacientes ALTER COLUMN status_termo SET DEFAULT 'Pendente';`
    );
    // Não é possível distinguir, depois do fato, quais "Não Enviado" eram
    // originalmente "Pendente" — reverter aqui não seria fiel de qualquer
    // forma, então o rollback não tenta desfazer os dados.
  }
};
